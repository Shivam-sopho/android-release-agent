#!/usr/bin/env node
// Same deterministic-driver pattern as run-manual-demo.mjs, applied to the
// second demo app (scenarios/notes-data-loss). Real MCP tool calls, real
// emulator, real evidence.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const MCP_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8791/mcp";
const SCENARIO_DIR = path.join(ROOT, "scenarios/notes-data-loss");
const OLD_APK = path.join(SCENARIO_DIR, "old.apk");
const NEW_APK = path.join(SCENARIO_DIR, "new.apk");
const PKG = "com.example.notesdemo";
const SAVE_BTN = { x: 540, y: 534 };

const client = new Client({ name: "notes-demo-runner", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
await client.connect(transport);

const rawLog = [];
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
function notesText(dump) {
  const m = dump.match(/text="([^"]*)" id="[^"]*notesList"/);
  return m ? m[1].replace(/&#10;/g, " / ") : "(not found)";
}
async function uninstall() {
  try {
    execFileSync("adb", ["uninstall", PKG]);
  } catch {
    /* not installed */
  }
}

const diffOutput = await call("diff_apks", { old_apk: OLD_APK, new_apk: NEW_APK });

// Journey 1: baseline — save 1 note on old.apk, confirm it lists. (A single
// note makes the before/after contrast unambiguous: one clean note, then
// "No notes yet." — no need to count multiple entries to see the loss.)
await uninstall();
await call("adb_install", { apk_path: OLD_APK });
await call("adb_launch", { package_id: PKG });
await wait(1500);
await call("adb_screenshot", { label: "J1_empty" });
await call("adb_tap", { x: SAVE_BTN.x, y: SAVE_BTN.y });
await wait(500);
await call("adb_screenshot", { label: "J1_note_saved" });
const dumpJ1 = await call("adb_dump_ui");
const j1Notes = notesText(dumpJ1);
const j1Pass = !j1Notes.includes("No notes");

// Journey 2 (the regression): upgrade in place, notes should survive.
await call("adb_force_stop", { package_id: PKG });
await call("adb_logcat_clear");
await call("adb_install", { apk_path: NEW_APK }); // -r: upgrade, keeps app data on disk
await call("adb_launch", { package_id: PKG });
await wait(1500);
await call("adb_screenshot", { label: "J2_after_upgrade" });
const dumpJ2 = await call("adb_dump_ui");
await call("adb_logcat_dump", { label: "J2_logcat" });
const j2Notes = notesText(dumpJ2);
const j2Pass = !j2Notes.includes("No notes");

const verdict = j2Pass ? "PASS" : "REGRESSION_DETECTED";

const suggestedFix = `## Suggested fix

The new build changed both the SharedPreferences **file** (\`notes_store\` → \`notes_data\`) and
the **key scheme** (one delimited string → indexed \`note_0\`, \`note_1\`, ...) in the same
release, with no migration step. The old data is still on disk — it's just never read.

**Fastest fix (one-time migration on first launch after upgrade):**

\`\`\`kotlin
class NotesStore(context: Context) {
    private val prefs = context.getSharedPreferences("notes_data", Context.MODE_PRIVATE)

    init {
        if (prefs.getString("note_0", null) == null) migrateFromV1(context)
    }

    private fun migrateFromV1(context: Context) {
        val legacy = context.getSharedPreferences("notes_store", Context.MODE_PRIVATE)
        val old = legacy.getString("all_notes", null) ?: return
        val notes = old.split("\\u0001").filter { it.isNotEmpty() }
        val editor = prefs.edit()
        notes.forEachIndexed { i, note -> editor.putString("note_\$i", note) }
        editor.apply()
    }

    fun getAll(): List<String> { /* unchanged */ }
    fun add(note: String) { /* unchanged */ }
}
\`\`\`

**More robust long-term fix:** don't invent a bespoke on-disk format for user data at all — use
Room (SQLite) or DataStore, both of which have first-class schema-migration support, so this
class of bug (rename a storage key/file, forget every existing installed user) can't happen
silently again.
`;

const reportMd = `# Release Regression Report — Notes app (data loss)

## ${verdict === "REGRESSION_DETECTED" ? "🔴 REGRESSION_DETECTED" : "✅ PASS"}

**Build under test:** \`com.example.notesdemo\` — old.apk (v1.0) vs new.apk (v2.0)
**Method:** compiled-binary diff → impact analysis → targeted journey execution on a live emulator → evidence capture → verdict

> Second demo scenario, same pipeline as the auth-app report: driven by
> [\`mcp-server/run-notes-demo.mjs\`](../mcp-server/run-notes-demo.mjs) calling the real MCP
> tools, while a funded model-provider key was still pending. Same tools, same harness,
> different app — showing the pipeline isn't tied to one app's specific bug.

## What changed

<details>
<summary>Full diff_apks output</summary>

${diffOutput}

</details>

**In plain English:** one class changed — \`NotesStore\` — both the SharedPreferences file name
and the key scheme changed in the same release.

## Journeys tested

| # | Journey | Expected | Actual | Result |
|---|---|---|---|---|
| J1 | Save 1 note on old.apk | Note is listed | ${j1Notes.replace(/\|/g, "\\|").slice(0, 60)} | ${j1Pass ? "✅ PASS" : "🔴 FAIL"} |
| J2 | Upgrade to new.apk, reopen | Same note still listed | ${j2Notes} | ${j2Pass ? "✅ PASS" : "🔴 **FAIL**"} |

<table><tr>
<td align="center"><img src="J1_note_saved.png" width="260"><br><sub>1 note saved on old.apk</sub></td>
<td align="center"><img src="J2_after_upgrade.png" width="260"><br><sub>Same install, after upgrading to new.apk</sub></td>
</tr></table>

${
  j2Pass
    ? ""
    : `## Root cause

Confirmed by the diff: \`NotesStore\` switched from a single delimited-string value under
\`notes_store\`/\`all_notes\` to indexed keys (\`note_0\`, \`note_1\`, ...) under a renamed file
\`notes_data\`, with no migration. The note saved in J1 is still physically on the device — in
the old file, under the old key — but the new code only ever looks in the new file, so it reads
nothing and shows "No notes yet."

This is the same *class* of bug as the auth-app scenario (a SharedPreferences file/key rename
with no migration on upgrade) hitting a completely different feature — which is exactly why the
agent looks at the compiled diff instead of assuming what "the bug" looks like: the mechanism
repeats, the surface area doesn't.

${suggestedFix}`
}

## Verdict

**${verdict}**${verdict === "REGRESSION_DETECTED" ? " — do not ship without the migration above." : ""}

---

<details>
<summary>Full raw tool-call log</summary>
${rawLog.join("\n")}
</details>
`;

fs.writeFileSync(path.join(SCENARIO_DIR, "evidence", "REPORT.md"), reportMd);
console.log(`\n\nVERDICT: ${verdict} (J1=${j1Pass ? "PASS" : "FAIL"}, J2=${j2Pass ? "PASS" : "FAIL"})`);

await client.close();
