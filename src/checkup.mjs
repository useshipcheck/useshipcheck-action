export const MARKER = "<!-- useshipcheck-action -->";
export const GRADES = ["A", "B", "C", "D", "F"];

const LETTER = { critical: "F", high: "D", medium: "C", low: "B", info: "A" };

export function categoryLetter(severity) {
  return LETTER[severity] || "";
}

export function shouldFail(grade, threshold) {
  const limit = String(threshold || "").trim().toUpperCase();
  if (!limit) return false;
  if (!GRADES.includes(limit)) {
    throw new Error("fail-on-grade must be A, B, C, D, or F.");
  }
  const gradeIndex = GRADES.indexOf(String(grade || "").toUpperCase());
  if (gradeIndex < 0) return false;
  return gradeIndex >= GRADES.indexOf(limit);
}

export function commentBody(report) {
  const host = safeText(report.host, "App");
  const grade = GRADES.includes(report.grade) ? report.grade : "–";
  const rows = [];
  for (const item of (report.categories || []).slice(0, 8)) {
    const letter = categoryLetter(item.severity);
    if (!letter) continue;
    rows.push(`| ${safeText(item.label || item.category, "Category")} | ${letter} |`);
  }
  const table = rows.length ? `| Category | Grade |\n| --- | --- |\n${rows.join("\n")}` : "No issue categories.";
  const share = publicShareUrl(report.shareUrl);
  const link = share ? `\n\n[Public score card](${share})` : "";
  return `${MARKER}\n### ShipCheck\n\n**${host}** · grade **${grade}**\n\n${table}${link}\n`;
}

export function publicShareUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (!url.pathname.startsWith("/s/")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export async function requestCheckup({ api, url, token, fetchImpl = fetch }) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`${String(api).replace(/\/$/, "")}/api/v1/scan`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, tier: token ? "full" : "preview" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "ShipCheck checkup failed");
  }
  return {
    grade: data.grade,
    host: data.host,
    categories: Array.isArray(data.categories) ? data.categories.map(publicCategory) : [],
    shareUrl: data.shareUrl,
  };
}

export async function upsertComment({ api, repo, token, number, body, fetchImpl = fetch }) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "useshipcheck-action",
    "x-github-api-version": "2022-11-28",
  };
  const listed = await fetchImpl(`${api}/repos/${repo}/issues/${number}/comments?per_page=100`, { headers });
  if (!listed.ok) throw new Error("Could not read pull request comments");
  const comments = await listed.json();
  const existing = Array.isArray(comments) ? comments.find((item) => String(item.body || "").includes(MARKER)) : null;
  const payload = JSON.stringify({ body });
  if (existing) {
    const updated = await fetchImpl(`${api}/repos/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers,
      body: payload,
    });
    if (!updated.ok) throw new Error("Could not update the ShipCheck comment");
    return "updated";
  }
  const created = await fetchImpl(`${api}/repos/${repo}/issues/${number}/comments`, {
    method: "POST",
    headers,
    body: payload,
  });
  if (!created.ok) throw new Error("Could not post the ShipCheck comment");
  return "created";
}

function publicCategory(item) {
  return { label: item?.label, category: item?.category, severity: item?.severity };
}

function safeText(value, fallback) {
  const text = String(value || "")
    .replace(/[\r\n<>[\]`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return text || fallback;
}
