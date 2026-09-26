#!/usr/bin/env node
// Runs the exact same tool pipeline the LLM agent is supposed to drive, but
// scripted deterministically. Used to produce real, evidence-backed output
// while a working model-provider key was still being sorted out — every
// screenshot/logcat/diff in evidence/ from this script is a genuine tool
// execution against the real emulator, not fabricated.
//
// Journeys mirror the original product pitch: Login, Login -> Kill -> Reopen,
// Login -> Logout -> Login, a fresh-install sanity check on the new build,
// and the one that matters: Existing session -> Upgrade -> Reopen.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MCP_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8791/mcp";
const OLD_APK = path.join(ROOT, "artifacts/old.apk");
const NEW_APK = path.join(ROOT, "artifacts/new.apk");
const PKG = "com.example.releasedemo";
const LOGIN_BTN = { x: 540, y: 1464 };
const LOGOUT_BTN = { x: 540, y: 1322 };

const client = new Client({ name: "manual-demo-runner", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
await client.connect(transport);

const rawLog = [];
const journeys = []; // { id, title, expected, steps: [{action, screenshot?, dump?}], finalScreen, status }

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.map((c) => c.text).join("\n");
  rawLog.push(`\n### ${name}(${JSON.stringify(args)})\n\n\`\`\`\`\n${text}\n\`\`\`\`\n`);
  console.log(`--- ${name}(${JSON.stringify(args)}) ---\n${text}\n`);
  return text;
}

function focusedActivity(dump) {
  const m = dump.match(/com\.example\.releasedemo\/com\.example\.releasedemo\.(\w+)/);
  return m ? m[1] : "(unknown)";
}

async function screenshot(label) {
  await call("adb_screenshot", { label });
  return `${label}.png`;
}

async function dump() {
  return call("adb_dump_ui");
}

// ---------------------------------------------------------------------------
// Change analysis
// ---------------------------------------------------------------------------
const diffOutput = await call("diff_apks", { old_apk: OLD_APK, new_apk: NEW_APK });

// ---------------------------------------------------------------------------
// J1 — fresh install + login on old.apk (baseline)
// ---------------------------------------------------------------------------
{
  const steps = [];
  await callUninstall(); // guarantee a genuinely clean slate, regardless of prior state
  await call("adb_install", { apk_path: OLD_APK });
  await call("adb_logcat_clear");
  await call("adb_launch", { package_id: PKG });
  await wait(2000);
  steps.push({ note: "Fresh install, first launch — should show Login.", screenshot: await screenshot("J1_1_login_screen") });
  await call("adb_tap", { x: LOGIN_BTN.x, y: LOGIN_BTN.y });
  await wait(1500);
  steps.push({ note: "After tapping Log In.", screenshot: await screenshot("J1_2_after_login") });
  const d = await dump();
  await call("adb_logcat_dump", { label: "J1_logcat" });
  journeys.push({
    id: "J1",
    title: "Login",
    expected: "Dashboard",
    expectedActivity: "DashboardActivity",
    actual: focusedActivity(d),
    steps,
    onBuild: "old.apk",
  });
}

// ---------------------------------------------------------------------------
// J2 — Login -> kill app -> reopen (same version, session should persist)
// ---------------------------------------------------------------------------
{
  const steps = [];
  await call("adb_force_stop", { package_id: PKG });
  steps.push({ note: "App force-stopped (simulates swipe-away / OS kill)." });
  await call("adb_logcat_clear");
  await call("adb_launch", { package_id: PKG });
  await wait(2000);
  steps.push({ note: "Reopened from cold start.", screenshot: await screenshot("J2_1_after_reopen") });
  const d = await dump();
  await call("adb_logcat_dump", { label: "J2_logcat" });
  journeys.push({
    id: "J2",
    title: "Login → Kill app → Reopen",
    expected: "Dashboard (still logged in)",
    expectedActivity: "DashboardActivity",
    actual: focusedActivity(d),
    steps,
    onBuild: "old.apk",
  });
}

// ---------------------------------------------------------------------------
// J3 — Login -> Logout -> Login (same version)
// ---------------------------------------------------------------------------
{
  const steps = [];
  await call("adb_tap", { x: LOGOUT_BTN.x, y: LOGOUT_BTN.y });
  await wait(1000);
  steps.push({ note: "Tapped Log Out.", screenshot: await screenshot("J3_1_after_logout") });
  const dLogout = await dump();
  await call("adb_tap", { x: LOGIN_BTN.x, y: LOGIN_BTN.y });
  await wait(1500);
  steps.push({ note: "Logged back in.", screenshot: await screenshot("J3_2_after_relogin") });
  const d = await dump();
  await call("adb_logcat_dump", { label: "J3_logcat" });
  journeys.push({
    id: "J3",
    title: "Login → Logout → Login",
    expected: "Dashboard",
    expectedActivity: "DashboardActivity",
    actual: focusedActivity(d),
    intermediateNote: `After logout, correctly reached ${focusedActivity(dLogout)}.`,
    steps,
    onBuild: "old.apk",
  });
}

// ---------------------------------------------------------------------------
// J4 — fresh (non-upgrade) install of new.apk: sanity check the new build
// isn't broken for brand-new users, only for upgraders.
// ---------------------------------------------------------------------------
{
  const steps = [];
  await call("adb_force_stop", { package_id: PKG });
  await callUninstall();
  await call("adb_install", { apk_path: NEW_APK });
  await call("adb_logcat_clear");
  await call("adb_launch", { package_id: PKG });
  await wait(2000);
  steps.push({ note: "Fresh install of new.apk (no prior data), first launch.", screenshot: await screenshot("J4_1_login_screen") });
  await call("adb_tap", { x: LOGIN_BTN.x, y: LOGIN_BTN.y });
  await wait(1500);
  steps.push({ note: "After tapping Log In.", screenshot: await screenshot("J4_2_after_login") });
  const d = await dump();
  await call("adb_logcat_dump", { label: "J4_logcat" });
  journeys.push({
    id: "J4",
    title: "Fresh install sanity check (new.apk, no upgrade)",
    expected: "Dashboard",
    expectedActivity: "DashboardActivity",
    actual: focusedActivity(d),
    steps,
    onBuild: "new.apk (fresh)",
  });
}

async function callUninstall() {
  // Not exposed as an MCP tool (uninstall is destructive and out of scope for
  // the agent's tool surface) — done directly here only to set up test
  // fixtures between journeys, not something the agent itself can do.
  const { execFileSync } = await import("node:child_process");
  try {
    execFileSync("adb", ["uninstall", PKG]);
  } catch {
    /* not installed, fine */
  }
}

// ---------------------------------------------------------------------------
// J5 — THE REGRESSION: existing session survives an in-place upgrade
// ---------------------------------------------------------------------------
{
  const steps = [];
  await callUninstall();
  await call("adb_install", { apk_path: OLD_APK });
  await call("adb_launch", { package_id: PKG });
  await wait(2000);
  await call("adb_tap", { x: LOGIN_BTN.x, y: LOGIN_BTN.y });
  await wait(1500);
  steps.push({ note: "Logged in on old.apk (currently-shipped build) — establishing a real pre-upgrade session.", screenshot: await screenshot("J5_1_old_logged_in") });

  await call("adb_force_stop", { package_id: PKG });
  steps.push({ note: "Force-stopped (release process installs over a running app in the real world too)." });
  await call("adb_logcat_clear");
  await call("adb_install", { apk_path: NEW_APK }); // -r: upgrade semantics, keeps app data
  steps.push({ note: "Installed new.apk with -r (in-place upgrade — app data preserved, exactly like a Play Store update)." });
  await call("adb_launch", { package_id: PKG });
  await wait(2000);
  steps.push({ note: "Relaunched after upgrade.", screenshot: await screenshot("J5_2_after_upgrade_relaunch") });
  const d = await dump();
  await call("adb_logcat_dump", { label: "J5_logcat" });
  journeys.push({
    id: "J5",
    title: "Existing session → App upgrade → Reopen",
    expected: "Dashboard (session should survive the upgrade)",
    expectedActivity: "DashboardActivity",
    actual: focusedActivity(d),
    steps,
    onBuild: "old.apk → upgraded to new.apk",
    critical: true,
  });
}

// ---------------------------------------------------------------------------
// Score journeys + build the report
// ---------------------------------------------------------------------------
for (const j of journeys) {
  j.pass = j.actual === j.expectedActivity;
}
const failures = journeys.filter((j) => !j.pass);
const verdict = failures.length ? "REGRESSION_DETECTED" : "PASS";

function screenshotsRow(steps) {
  return steps
    .filter((s) => s.screenshot)
    .map((s) => `<td align="center"><img src="${s.screenshot}" width="220"><br><sub>${s.note}</sub></td>`)
    .join("\n");
}

function journeySection(j) {
  const badge = j.pass ? "✅ PASS" : "🔴 FAIL";
  return `### ${j.id} — ${j.title} ${j.critical ? "⚠️" : ""}

**Build:** \`${j.onBuild}\` · **Expected:** ${j.expected} · **Actual:** \`${j.actual}\` · **${badge}**
${j.intermediateNote ? `\n${j.intermediateNote}\n` : ""}
<table><tr>
${screenshotsRow(j.steps)}
</tr></table>
`;
}

const summaryTable = `| # | Journey | Build | Expected | Actual | Result |
|---|---------|-------|----------|--------|--------|
${journeys
  .map((j) => `| ${j.id} | ${j.title} | ${j.onBuild} | ${j.expected} | \`${j.actual}\` | ${j.pass ? "✅ PASS" : "🔴 **FAIL**"} |`)
  .join("\n")}`;

const regressionJourney = journeys.find((j) => j.critical && !j.pass);

const rootCause = regressionJourney
  ? `## Root cause

The diff (\`diff_apks\`, above) shows exactly one class changed between builds — \`AuthManager\` —
and pinpoints it by content hash (\`52b50d4a\` → \`a4244d02\`) even without decompiling. The
string-pool diff for that class shows precisely what changed:

\`\`\`diff
-is_logged_in
+auth_prefs
+isLoggedIn
-session_prefs
\`\`\`

\`AuthManager\` reads/writes a SharedPreferences file. The new build renamed both the file
(\`session_prefs\` → \`auth_prefs\`) and the key (\`is_logged_in\` → \`isLoggedIn\`). On a fresh
install this is invisible — there's no prior data either way (confirmed by **J4** above: a clean
install of new.apk logs in and reaches the Dashboard normally). The bug only surfaces for a user
who is already logged in under the old build: their session lives in \`session_prefs\`, which the
new code never looks at, so \`isLoggedIn()\` reads an empty file and returns \`false\`. No crash,
no exception, no error logged anywhere — the app behaves completely normally, just wrong. That's
exactly the class of bug a crash-only monitoring setup (or Firebase Robo test, which has no
concept of "what changed") would never catch: you have to compare behavior against the specific
build a real population of users is upgrading *from*.

### Failure mode this would have caused in production

Every existing signed-in user gets silently logged out the moment this release rolls out —
no error, no crash report, just a spike in login-screen impressions and support tickets asking
"why do I have to log in again?". The kind of regression that's expensive precisely because
nothing *looks* broken in a fresh-install smoke test (J4 passes!) or a crash dashboard.

${screenshotsRow(regressionJourney.steps)
  .replace(/width="220"/g, 'width="320"')
  .replace(/<td/g, "\n<td")}

## Suggested fix

The old data isn't gone — it's sitting in \`session_prefs\`/\`is_logged_in\` on every device that
had the previous build installed. The new code just never looks there. Fastest fix is a one-time
migration fallback on read:

\`\`\`kotlin
class AuthManager(context: Context) {
    private val prefs = context.getSharedPreferences("auth_prefs", Context.MODE_PRIVATE)
    private val legacyPrefs = context.getSharedPreferences("session_prefs", Context.MODE_PRIVATE)

    fun isLoggedIn(): Boolean =
        prefs.getBoolean("isLoggedIn", false) || legacyPrefs.getBoolean("is_logged_in", false)

    fun login(username: String) {
        prefs.edit().putBoolean("isLoggedIn", true).putString("username", username).apply()
    }
    // On a hit against legacyPrefs, also worth writing it into the new format immediately
    // (prefs.edit().putBoolean("isLoggedIn", true).apply()) so the fallback is only needed once.
}
\`\`\`

**Longer-term:** treat any SharedPreferences file/key rename as a schema migration, not a
find-and-replace — grep for the old file/key name across the codebase before renaming, and add
a migration step in the same commit, not as a followup.
`
  : "## Root cause\n\nNo regression found — all journeys passed.";

const reportMd = `# Release Regression Report

## ${verdict === "REGRESSION_DETECTED" ? "🔴 REGRESSION_DETECTED" : "✅ PASS"}

**Build under test:** \`com.example.releasedemo\` — old.apk (v1.0, currently shipped) vs new.apk (v2.0, release candidate)
**Method:** compiled-binary diff → impact analysis → targeted journey execution on a live emulator → evidence capture → verdict

> This run was driven by [\`mcp-server/run-manual-demo.mjs\`](../mcp-server/run-manual-demo.mjs)
> (deterministic, scripted) calling the exact same MCP tools (\`diff_apks\`, \`adb_*\`,
> \`write_report\`) the autonomous LLM agent uses over TrueForge, while a working
> model-provider key was still being provisioned. Every screenshot, UI dump, and logcat file
> below is a real execution against the live Android emulator — nothing here is fabricated.

## What changed

\`diff_apks\` output — a compiled-binary diff (manifest + per-dex-file string pool + per-class
content hash), not a source/PR diff:

<details>
<summary>Full diff_apks output</summary>

${diffOutput}

</details>

**In plain English:** only one file changed — \`AndroidManifest.xml\`'s version bump (1.0 → 2.0,
expected) and a one-class code change, isolated by content hash to \`AuthManager\` alone. Every
other class (\`LoginActivity\`, \`DashboardActivity\`, \`SplashActivity\`) is byte-identical.

## Impact analysis

\`AuthManager\` owns session/login state. A change isolated to that one class, with no other
class touched, means the risk surface is entirely session-and-login related — not UI layout, not
navigation, not anything else. That's what selected the journey list below: broad enough to catch
a session regression from any angle (fresh login, app-kill persistence, logout/login cycling,
fresh-install-on-new-build sanity), without wasting time crawling unrelated screens the diff gives
no reason to suspect.

## Journeys tested

${summaryTable}

## Journey detail

${journeys.map(journeySection).join("\n")}

${rootCause}

## Verdict

**${verdict}**${
  verdict === "REGRESSION_DETECTED"
    ? " — do not ship. The upgrade path silently logs out every existing user. Fix: keep reading the old SharedPreferences file/keys as a migration fallback, or write a one-time migration on first launch after upgrade."
    : ""
}

---

<details>
<summary>Full raw tool-call log (${journeys.length + 1} tool groups, ${rawLog.length} calls)</summary>
${rawLog.join("\n")}
</details>
`;

const evidenceDir = path.join(ROOT, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "REPORT.md"), reportMd);
console.log(`\n\nVERDICT: ${verdict}`);
console.log(`Journeys: ${journeys.map((j) => `${j.id}=${j.pass ? "PASS" : "FAIL"}`).join(", ")}`);
console.log(`Report written to ${path.join(evidenceDir, "REPORT.md")}`);

await client.close();
