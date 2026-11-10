import { appendFileSync, readFileSync } from "node:fs";
import { commentBody, publicShareUrl, requestCheckup, shouldFail, upsertComment } from "./checkup.mjs";

const api = (process.env.SHIPCHECK_API || "https://useshipcheck.com").replace(/\/$/, "");
const url = process.env.INPUT_URL || "";
const token = process.env.INPUT_API_TOKEN || "";
const threshold = process.env.INPUT_FAIL_ON_GRADE || "";
const comment = String(process.env.INPUT_COMMENT ?? "true").toLowerCase() !== "false";

if (!url) {
  console.error("url is required");
  process.exit(1);
}

const report = await requestCheckup({ api, url, token: token || undefined });
const shareUrl = publicShareUrl(report.shareUrl);
const body = commentBody({ ...report, shareUrl });
writeOutput("grade", report.grade || "");
writeOutput("share-url", shareUrl);
console.log(`${report.grade}  ${report.host}`);
if (shareUrl) console.log(shareUrl);

if (comment) await postComment(body);

if (shouldFail(report.grade, threshold)) {
  console.error(`Grade ${report.grade} is ${threshold} or worse.`);
  process.exit(1);
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value).replace(/\n/g, "")}\n`);
}

async function postComment(body) {
  const number = pullNumber();
  const githubToken = process.env.GITHUB_TOKEN || "";
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (!number || !githubToken || !repo) {
    console.error("No pull request comment posted. This step is not on a pull request, or GITHUB_TOKEN is missing.");
    return;
  }
  const githubApi = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const result = await upsertComment({
    api: githubApi,
    repo,
    token: githubToken,
    number,
    body,
  });
  console.log(`Pull request comment ${result}.`);
}

function pullNumber() {
  if (!process.env.GITHUB_EVENT_PATH) return null;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    return event.pull_request?.number || event.issue?.number || null;
  } catch {
    return null;
  }
}
