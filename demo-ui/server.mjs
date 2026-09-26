import express from "express";
import multer from "multer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

const PORT = process.env.PORT || 8792;
const TRUEFORGE_BASE = process.env.TRUEFORGE_BASE || "http://localhost:8790";
const AGENT_NAME = process.env.AGENT_NAME || "android-release-agent";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve("../artifacts");
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve("../evidence");
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const upload = multer({ dest: path.join(ARTIFACTS_DIR, ".uploads") });
const LIVE_MARKER = "/tmp/android-release-agent-live-run-marker.json";
const LIVE_DECISION = "/tmp/android-release-agent-live-decision.json";

function findAapt() {
  const home = process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
  const buildTools = path.join(home, "build-tools");
  if (!fs.existsSync(buildTools)) return null;
  const versions = fs.readdirSync(buildTools).sort().reverse();
  for (const v of versions) {
    const p = path.join(buildTools, v, "aapt");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Not hardcoded to the demo app: read the real applicationId out of whatever
// APK was actually uploaded, so the pipeline works on any app given to it.
function detectPackageId(apkPath) {
  const aapt = findAapt();
  if (!aapt) return null;
  try {
    const out = execFileSync(aapt, ["dump", "badging", apkPath], { encoding: "utf8" });
    const m = out.match(/package: name='([^']+)'/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const app = express();
app.use(express.json());
app.use("/evidence", express.static(EVIDENCE_DIR));
app.use(express.static("public"));

// In-memory single-demo session state (fine for a one-machine hackathon demo).
let sessionId = null;
let currentPackageId = null;

async function ensureSession() {
  if (sessionId) return sessionId;
  const res = await fetch(`${TRUEFORGE_BASE}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: { name: AGENT_NAME } }),
  });
  if (!res.ok) throw new Error(`create session failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  sessionId = data.data.id;
  return sessionId;
}

app.post("/api/reset", async (_req, res) => {
  sessionId = null;
  res.json({ ok: true });
});

app.post("/api/upload", upload.fields([{ name: "old_apk" }, { name: "new_apk" }]), async (req, res) => {
  try {
    const oldFile = req.files?.old_apk?.[0];
    const newFile = req.files?.new_apk?.[0];
    if (!oldFile || !newFile) return res.status(400).json({ error: "old_apk and new_apk are both required" });

    const oldDest = path.join(ARTIFACTS_DIR, "old.apk");
    const newDest = path.join(ARTIFACTS_DIR, "new.apk");
    fs.copyFileSync(oldFile.path, oldDest);
    fs.copyFileSync(newFile.path, newDest);
    fs.unlinkSync(oldFile.path);
    fs.unlinkSync(newFile.path);

    // Fresh evidence dir per run.
    fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    currentPackageId = detectPackageId(newDest) || detectPackageId(oldDest);
    fs.writeFileSync(
      LIVE_MARKER,
      JSON.stringify({ ts: Date.now(), old_apk: oldDest, new_apk: newDest, package_id: currentPackageId })
    );

    res.json({ ok: true, old_apk: oldDest, new_apk: newDest, package_id: currentPackageId });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------------------
// Live mode: instead of proxying to TrueForge, a locally-driven process (see
// mcp-server/run-live-demo.mjs) pushes real events here as it performs real
// tool calls, and the browser renders them exactly like a TrueForge turn
// stream — including a real approval-gate pause the browser's Allow/Deny
// buttons resolve.
// ---------------------------------------------------------------------------
let liveClients = [];

app.get("/api/live/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  liveClients.push(res);
  req.on("close", () => {
    liveClients = liveClients.filter((c) => c !== res);
  });
});

app.post("/api/live/event", (req, res) => {
  const payload = `data: ${JSON.stringify(req.body)}\n\n`;
  for (const c of liveClients) c.write(payload);
  res.json({ ok: true, clients: liveClients.length });
});

app.post("/api/live/decide", (req, res) => {
  fs.writeFileSync(LIVE_DECISION, JSON.stringify(req.body));
  res.json({ ok: true });
});

app.get("/api/live/decision", (req, res) => {
  if (!fs.existsSync(LIVE_DECISION)) return res.json({ decision: null });
  const d = JSON.parse(fs.readFileSync(LIVE_DECISION, "utf8"));
  fs.unlinkSync(LIVE_DECISION);
  res.json({ decision: d });
});

app.get("/api/live/marker", (req, res) => {
  if (!fs.existsSync(LIVE_MARKER)) return res.json({ marker: null });
  res.json({ marker: JSON.parse(fs.readFileSync(LIVE_MARKER, "utf8")) });
});

async function proxyTurn(body, res) {
  const sid = await ensureSession();
  const upstream = await fetch(`${TRUEFORGE_BASE}/api/v1/sessions/${sid}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (!upstream.body) {
    res.end();
    return;
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  req_loop: while (true) {
    const { done, value } = await reader.read();
    if (done) break req_loop;
    res.write(decoder.decode(value, { stream: true }));
  }
  res.end();
}

app.post("/api/run", async (req, res) => {
  const oldPath = path.join(ARTIFACTS_DIR, "old.apk");
  const newPath = path.join(ARTIFACTS_DIR, "new.apk");
  const pkg = currentPackageId || detectPackageId(newPath) || detectPackageId(oldPath);
  const message =
    `A new Android release is ready to ship. Analyze it end to end and give a release-readiness verdict.\n\n` +
    `old.apk: ${oldPath}\n` +
    `new.apk: ${newPath}\n` +
    (pkg
      ? `Both are the same app (package ${pkg}), old is the currently-shipped build, new is the candidate release.\n\n`
      : `Both are the same app (currently-shipped build vs. release candidate) — detect the applicationId yourself from the diff/manifest.\n\n`) +
    `Do this:\n` +
    `1. diff_apks to see what actually changed in the compiled build.\n` +
    `2. Reason about which user journeys that change could affect (don't just crawl randomly — pick journeys based on what the diff implies, whatever this specific app turns out to do).\n` +
    `3. For each journey you pick: adb_install old.apk fresh, drive it with adb_tap/adb_dump_ui (use adb_dump_ui first to find real element bounds — never guess coordinates, this app's layout is unknown to you), adb_screenshot at key steps, adb_logcat_clear before / adb_logcat_dump after. Then adb_force_stop, adb_install -r new.apk (in-place upgrade, keeps app data), repeat the same journey, and compare the end state (use adb_dump_ui's focused_window as ground truth for which screen you ended up on).\n` +
    `4. Prioritize whatever the diff actually implicates — if it touches auth/session code, test login and an 'existing session survives an app upgrade' journey; if it touches something else, test that instead.\n` +
    `5. write_report with a markdown regression report (what changed, what you tested, what you found, evidence file paths).\n` +
    `6. Always finish by calling request_release_approval with your verdict — even if everything passed.`;

  await proxyTurn({ input: [{ type: "user.message", content: message }], stream: true }, res);
});

app.post("/api/approve", async (req, res) => {
  const { thread_id, tool_call_id, status, reason } = req.body;
  const approval = status === "allow" ? { status: "allow" } : { status: "deny", reason: reason || "Denied by reviewer" };
  await proxyTurn(
    {
      input: [{ type: "user.tool_approval", thread_id, tool_call_id, approval }],
      previous_turn_id: "auto",
      stream: true,
    },
    res
  );
});

app.get("/report", (req, res) => {
  const reportPath = path.join(EVIDENCE_DIR, "REPORT.md");
  if (!fs.existsSync(reportPath)) return res.status(404).send("No report yet — run the agent first.");
  const md = fs.readFileSync(reportPath, "utf8");
  const html = marked.parse(md, { gfm: true });
  res.send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Release Regression Report</title>
<base href="/evidence/">
<style>
  :root { color-scheme: dark; }
  body { background:#0b0d10; color:#e6e9ee; font-family: -apple-system, system-ui, sans-serif; max-width: 900px; margin: 0 auto; padding: 32px 24px 80px; line-height: 1.6; }
  h1,h2,h3 { border-bottom: 1px solid #232a33; padding-bottom: 8px; }
  code { background:#12161b; padding: 2px 6px; border-radius: 4px; }
  pre { background:#12161b; padding: 14px; border-radius: 8px; overflow-x: auto; border: 1px solid #232a33; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; border-radius: 6px; border: 1px solid #232a33; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #232a33; padding: 8px 12px; text-align: left; }
  a { color: #4f8cff; }
  details summary { cursor: pointer; color: #8b95a3; }
  .topbar { display:flex; justify-content: flex-end; margin-bottom: 16px; }
  .topbar a { background:#4f8cff; color:white; text-decoration:none; padding:8px 16px; border-radius:6px; font-weight:600; }
</style></head>
<body>
<div class="topbar"><a href="/evidence/REPORT.md" download="release-regression-report.md">⬇ Download report (.md)</a></div>
${html}
</body></html>`);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Release agent control panel: http://127.0.0.1:${PORT}`);
});
