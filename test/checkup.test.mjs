import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { commentBody, MARKER, shouldFail, upsertComment } from "../src/checkup.mjs";

const forbidden = ["sk_test_", "sk-proj-", "ghp_", "postgres://", "BEGIN PRIVATE KEY", "whsec_", "fingerprint"];

test("comment keeps the grade and share card, and drops evidence", () => {
  const body = commentBody({
    host: "notes.example",
    grade: "C",
    shareUrl: "https://useshipcheck.com/s/abc",
    categories: [{ label: "Headers", severity: "medium", count: 4, detail: "sk_test_ShipCheckSampleKey51ab" }],
    findings: [{ title: "postgres://app_user:secret@db/app" }],
    url: "https://useshipcheck.com/results/scn_private",
  });
  assert.match(body, /grade \*\*C\*\*/);
  assert.match(body, /\| Headers \| C \|/);
  assert.match(body, /https:\/\/useshipcheck.com\/s\/abc/);
  assert.equal(body.includes("/results/"), false);
  assert.equal(body.includes("sk_test_"), false);
  assert.equal(body.includes("postgres://"), false);
  assert.equal(body.startsWith(MARKER), true);
});

test("fails only at or below the chosen grade", () => {
  assert.equal(shouldFail("C", ""), false);
  assert.equal(shouldFail("C", "D"), false);
  assert.equal(shouldFail("D", "D"), true);
  assert.equal(shouldFail("F", "D"), true);
  assert.equal(shouldFail("A", "A"), true);
  assert.throws(() => shouldFail("A", "Z"));
});

test("updates the existing sticky comment", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body });
    if (!init.method || init.method === "GET") {
      return json([{ id: 9, body: `${MARKER}\nold` }]);
    }
    return json({ id: 9 });
  };
  const result = await upsertComment({
    api: "https://api.github.com",
    repo: "octo/demo",
    token: "ghs_test",
    number: 4,
    body: `${MARKER}\nnew`,
    fetchImpl,
  });
  assert.equal(result, "updated");
  assert.equal(calls[1].method, "PATCH");
  assert.match(calls[1].url, /issues\/comments\/9$/);
  assert.equal(String(calls[1].body).includes("ghs_test"), false);
});

test("sample app checkup posts one comment and does not fail without a grade gate", { timeout: 120_000 }, async () => {
  const github = await githubMock();
  const dir = await mkdtemp(path.join(tmpdir(), "shipcheck-action-"));
  const output = path.join(dir, "outputs");
  const eventPath = path.join(dir, "event.json");
  await writeFile(output, "");
  await writeFile(eventPath, JSON.stringify({ pull_request: { number: 7 } }));
  const child = spawn(process.execPath, [path.join(import.meta.dirname, "../src/run.mjs")], {
    env: {
      ...process.env,
      INPUT_URL: "https://useshipcheck.com/sample-app",
      INPUT_API_TOKEN: "",
      INPUT_FAIL_ON_GRADE: "",
      INPUT_COMMENT: "true",
      SHIPCHECK_API: "https://useshipcheck.com",
      GITHUB_TOKEN: "ghs_local_test",
      GITHUB_REPOSITORY: "octo/demo",
      GITHUB_API_URL: github.url,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: output,
    },
  });
  let stderr = "";
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  const written = await readFile(output, "utf8");
  await github.close();
  await rm(dir, { recursive: true, force: true });
  assert.equal(code, 0, stderr || stdout);
  assert.match(written, /^grade=[A-F]$/m);
  assert.equal(github.posts.length, 1);
  const comment = JSON.parse(github.posts[0]).body;
  assert.match(comment, /grade \*\*[A-F]\*\*/);
  const share = written.match(/^share-url=(https:\/\/useshipcheck.com\/s\/\S+)/m);
  if (share) assert.match(comment, new RegExp(share[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const secret of forbidden) assert.equal(comment.includes(secret), false, secret);
  assert.equal(comment.includes("ghs_local_test"), false);
});

function json(data) {
  return { ok: true, json: async () => data };
}

function githubMock() {
  const posts = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      if (req.method === "POST") posts.push(body);
      res.setHeader("content-type", "application/json");
      res.end(req.method === "GET" ? "[]" : JSON.stringify({ id: 1 }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        posts,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
