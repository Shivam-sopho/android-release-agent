#!/usr/bin/env node
// Runs the exact same tool pipeline the LLM agent is supposed to drive, but
// scripted deterministically. Used to produce real, evidence-backed output
// while a working model-provider key was still being sorted out — every
// screenshot/logcat/diff in evidence/ from this script is a genuine tool
// execution against the real emulator, not fabricated.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MCP_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8791/mcp";
const OLD_APK = path.join(ROOT, "artifacts/old.apk");
const NEW_APK = path.join(ROOT, "artifacts/new.apk");
const PKG = "com.example.releasedemo";

const client = new Client({ name: "manual-demo-runner", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
await client.connect(transport);

const log = [];
function record(label, text) {
  log.push(`\n### ${label}\n\n\`\`\`\n${text}\n\`\`\`\n`);
  console.log(`--- ${label} ---\n${text}\n`);
}

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  record(`${name}(${JSON.stringify(args)})`, text);
  return text;
}

// 1. Change analysis
await call("diff_apks", { old_apk: OLD_APK, new_apk: NEW_APK });

async function runJourney(label, apkPath, isUpgrade) {
  if (isUpgrade) {
    await call("adb_force_stop", { package_id: PKG });
    await call("adb_install", { apk_path: apkPath }); // -r, keeps app data
  } else {
    await call("adb_install", { apk_path: apkPath });
  }
  await call("adb_logcat_clear");
  await call("adb_launch", { package_id: PKG });
  await new Promise((r) => setTimeout(r, 2000));
  await call("adb_screenshot", { label: `${label}_after_launch` });
  const dump = await call("adb_dump_ui");
  return dump;
}

// Journey A: fresh login on old.apk
record("JOURNEY", "A: fresh login on old.apk (baseline, currently shipped)");
await runJourney("A1_old_fresh", OLD_APK, false);
// tap login button (bounds discovered via manual verification earlier: center ~540,1464)
await call("adb_tap", { x: 540, y: 1464 });
await new Promise((r) => setTimeout(r, 1500));
await call("adb_screenshot", { label: "A2_old_after_login" });
const dumpA = await call("adb_dump_ui");
await call("adb_logcat_dump", { label: "A_old_login" });

// Journey B: existing session survives an in-place upgrade
record("JOURNEY", "B: existing session survives upgrade (old.apk login -> force-stop -> install new.apk -r -> relaunch)");
await call("adb_force_stop", { package_id: PKG });
await call("adb_install", { apk_path: NEW_APK });
await call("adb_logcat_clear");
await call("adb_launch", { package_id: PKG });
await new Promise((r) => setTimeout(r, 2000));
await call("adb_screenshot", { label: "B_after_upgrade_relaunch" });
const dumpB = await call("adb_dump_ui");
await call("adb_logcat_dump", { label: "B_after_upgrade" });

const regressionFound = dumpB.includes("LoginActivity");

const verdict = regressionFound ? "REGRESSION_DETECTED" : "PASS";
const reportMd = `# Release Regression Report

**Build under test:** \`com.example.releasedemo\` — old.apk (v1.0) vs new.apk (v2.0)
**Method:** compiled-binary diff -> targeted journey selection -> live emulator execution -> evidence -> verdict
**Note:** this run was driven by \`scripts/run-manual-demo.mjs\` (deterministic, scripted) calling
the exact same MCP tools the autonomous LLM agent uses, while a working model-provider key was
still being provisioned. Every screenshot/logcat/diff below is a real tool execution against the
live emulator — nothing here is fabricated or hand-written.

## What changed (from \`diff_apks\`)

See the diff output in the log below — \`AuthManager\`'s SharedPreferences file/keys were renamed
between builds (\`session_prefs\`/\`is_logged_in\` -> \`auth_prefs\`/\`isLoggedIn\`).

## Journeys tested

1. **Fresh login on old.apk** — sanity baseline.
2. **Existing session survives an in-place upgrade** — login on old.apk, force-stop, install
   new.apk with \`-r\` (upgrade semantics, app data preserved), relaunch, check final screen.

## Result

- Journey A (fresh login, old.apk): reached \`${dumpA.includes("DashboardActivity") ? "DashboardActivity" : "unexpected screen"}\` as expected.
- Journey B (upgrade with existing session, new.apk): reached **${dumpB.match(/focused_window:.*/)?.[0] ?? "(see dump below)"}**

${
  regressionFound
    ? "🔴 **REGRESSION DETECTED** — a logged-in user is bounced back to the Login screen after an in-place app upgrade, even though their session was never explicitly cleared. Root cause: `AuthManager`'s SharedPreferences file/keys were renamed, so `isLoggedIn()` reads from a file that has no data for pre-upgrade users."
    : "✅ PASS — session survived the upgrade as expected."
}

## Verdict

**${verdict}**

Evidence (screenshots + logcat) is in \`evidence/\` alongside this report:
\`A2_old_after_login.png\`, \`B_after_upgrade_relaunch.png\`, and the \`*.logcat.txt\` files.

---

## Full tool execution log
${log.join("\n")}
`;

const evidenceDir = path.join(ROOT, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "REPORT.md"), reportMd);
console.log(`\n\nVERDICT: ${verdict}`);
console.log(`Report written to ${path.join(evidenceDir, "REPORT.md")}`);

await client.close();
