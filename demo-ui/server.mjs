import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 8792;
const TRUEFORGE_BASE = process.env.TRUEFORGE_BASE || "http://localhost:8790";
const AGENT_NAME = process.env.AGENT_NAME || "android-release-agent";
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || path.resolve("../artifacts");
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve("../evidence");
fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const upload = multer({ dest: path.join(ARTIFACTS_DIR, ".uploads") });

const app = express();
app.use(express.json());
app.use("/evidence", express.static(EVIDENCE_DIR));
app.use(express.static("public"));

// In-memory single-demo session state (fine for a one-machine hackathon demo).
let sessionId = null;

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

    res.json({ ok: true, old_apk: oldDest, new_apk: newDest });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
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
  const message =
    `A new Android release is ready to ship. Analyze it end to end and give a release-readiness verdict.\n\n` +
    `old.apk: ${oldPath}\n` +
    `new.apk: ${newPath}\n` +
    `Both are the same app (package com.example.releasedemo), old is the currently-shipped build, new is the candidate release.\n\n` +
    `Do this:\n` +
    `1. diff_apks to see what actually changed in the compiled build.\n` +
    `2. Reason about which user journeys that change could affect (don't just crawl randomly).\n` +
    `3. For each journey you pick: adb_install old.apk fresh, drive it with adb_tap/adb_dump_ui, adb_screenshot at key steps, adb_logcat_clear before / adb_logcat_dump after. Then adb_force_stop, adb_install -r new.apk (in-place upgrade, keeps app data), repeat the same journey, and compare the end state (use adb_dump_ui's focused_window as ground truth for which screen you ended up on).\n` +
    `4. Definitely test: a fresh login journey, AND an 'existing session survives an app upgrade' journey (login on old, force-stop, upgrade to new, relaunch, check you're still on the dashboard and not bounced to login).\n` +
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Release agent control panel: http://127.0.0.1:${PORT}`);
});
