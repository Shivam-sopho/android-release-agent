import express from "express";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 8791;
const EVIDENCE_DIR = process.env.EVIDENCE_DIR || path.resolve("./evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

function adb(args, opts = {}) {
  return execFileSync("adb", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 50, ...opts });
}

function text(s) {
  return { content: [{ type: "text", text: s }] };
}

const server = new McpServer({ name: "android-release-agent-tools", version: "1.0.0" });

server.registerTool(
  "diff_apks",
  {
    description:
      "Diff two compiled APKs (old vs new) at the binary level: AndroidManifest.xml (permissions, activities, services, receivers), and dex string-pool / size deltas per class file. This is a real diff of the shipped artifact, not the source/git diff. Use this FIRST to understand what actually changed before deciding what to test.",
    inputSchema: { old_apk: z.string().describe("Path to old.apk"), new_apk: z.string().describe("Path to new.apk") },
  },
  async ({ old_apk, new_apk }) => {
    const tmp = fs.mkdtempSync("/tmp/apkdiff-");
    const oldDir = path.join(tmp, "old");
    const newDir = path.join(tmp, "new");
    fs.mkdirSync(oldDir);
    fs.mkdirSync(newDir);
    execSync(`unzip -o -q "${old_apk}" -d "${oldDir}"`);
    execSync(`unzip -o -q "${new_apk}" -d "${newDir}"`);

    const aapt = findAapt();
    let manifestDiff = "(aapt not found — manifest diff skipped)";
    if (aapt) {
      const oldManifest = execFileSync(aapt, ["dump", "xmltree", old_apk, "AndroidManifest.xml"], { encoding: "utf8" });
      const newManifest = execFileSync(aapt, ["dump", "xmltree", new_apk, "AndroidManifest.xml"], { encoding: "utf8" });
      fs.writeFileSync(path.join(tmp, "old_manifest.txt"), oldManifest);
      fs.writeFileSync(path.join(tmp, "new_manifest.txt"), newManifest);
      try {
        manifestDiff = execSync(`diff -u "${path.join(tmp, "old_manifest.txt")}" "${path.join(tmp, "new_manifest.txt")}" || true`, {
          encoding: "utf8",
        });
        if (!manifestDiff.trim()) manifestDiff = "(no manifest differences)";
      } catch (e) {
        manifestDiff = String(e);
      }
    }

    // Multidex apps split classes across classes.dex, classes2.dex, classes3.dex, ... —
    // diffing only classes.dex silently misses app code that landed in a later dex file
    // (e.g. classes.dex is often just the desugared stdlib; app code can end up in classes3.dex).
    // Compare every dex file present in either build, by name.
    const oldDexFiles = fs.readdirSync(oldDir).filter((f) => /^classes\d*\.dex$/.test(f));
    const newDexFiles = fs.readdirSync(newDir).filter((f) => /^classes\d*\.dex$/.test(f));
    const allDexNames = [...new Set([...oldDexFiles, ...newDexFiles])].sort();

    const sizeLines = [];
    const stringDiffs = [];
    for (const name of allDexNames) {
      const oldPath = path.join(oldDir, name);
      const newPath = path.join(newDir, name);
      const oldExists = fs.existsSync(oldPath);
      const newExists = fs.existsSync(newPath);
      const oldSize = oldExists ? fs.statSync(oldPath).size : 0;
      const newSize = newExists ? fs.statSync(newPath).size : 0;

      if (!oldExists) {
        sizeLines.push(`${name}: added in new.apk (${newSize} bytes)`);
        continue;
      }
      if (!newExists) {
        sizeLines.push(`${name}: removed in new.apk (was ${oldSize} bytes)`);
        continue;
      }
      sizeLines.push(`${name}: ${oldSize} -> ${newSize} bytes (delta ${newSize - oldSize})${oldSize === newSize ? " [identical size]" : ""}`);

      const oldStrings = execSync(`strings "${oldPath}" | sort -u`, { encoding: "utf8" });
      const newStrings = execSync(`strings "${newPath}" | sort -u`, { encoding: "utf8" });
      if (oldStrings === newStrings) continue; // no point emitting a no-op diff per file
      const oldFile = path.join(tmp, `${name}.old.strings`);
      const newFile = path.join(tmp, `${name}.new.strings`);
      fs.writeFileSync(oldFile, oldStrings);
      fs.writeFileSync(newFile, newStrings);
      const d = execSync(`diff -u "${oldFile}" "${newFile}" || true`, { encoding: "utf8" });
      if (d.trim()) stringDiffs.push(`--- ${name} string-pool diff ---\n${d}`);
    }

    const listDiff = sizeLines.join("\n");
    const stringDiff = stringDiffs.length ? stringDiffs.join("\n\n") : "(no string-pool differences in any dex file)";

    fs.rmSync(tmp, { recursive: true, force: true });

    return text(
      [
        "## APK diff (compiled binary, not source)",
        listDiff,
        "",
        "### AndroidManifest.xml diff",
        "```",
        manifestDiff.slice(0, 4000),
        "```",
        "",
        "### classes.dex string-pool diff (reveals changed string literals — e.g. SharedPreferences keys/file names, constants)",
        "```",
        stringDiff.slice(0, 4000),
        "```",
      ].join("\n")
    );
  }
);

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

server.registerTool(
  "adb_install",
  {
    description: "Install (or upgrade in place with -r, preserving app data) an APK onto the connected emulator/device.",
    inputSchema: { apk_path: z.string() },
  },
  async ({ apk_path }) => text(adb(["install", "-r", apk_path]))
);

server.registerTool(
  "adb_force_stop",
  {
    description: "Force-stop an app (simulates the app being fully killed / swiped away), so the next launch is a cold start.",
    inputSchema: { package_id: z.string() },
  },
  async ({ package_id }) => {
    adb(["shell", "am", "force-stop", package_id]);
    return text(`force-stopped ${package_id}`);
  }
);

server.registerTool(
  "adb_launch",
  {
    description: "Launch an app's default launcher activity (cold start from the home screen).",
    inputSchema: { package_id: z.string() },
  },
  async ({ package_id }) => {
    adb(["shell", "monkey", "-p", package_id, "-c", "android.intent.category.LAUNCHER", "1"]);
    return text(`launched ${package_id}`);
  }
);

server.registerTool(
  "adb_tap",
  {
    description: "Tap the screen at pixel coordinates (x, y). Get coordinates from adb_dump_ui's element bounds first.",
    inputSchema: { x: z.number(), y: z.number() },
  },
  async ({ x, y }) => {
    adb(["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))]);
    return text(`tapped (${x}, ${y})`);
  }
);

server.registerTool(
  "adb_dump_ui",
  {
    description:
      "Dump the current screen: which activity is focused (ground truth for 'what screen am I on'), plus visible text elements and their tap bounds [left,top][right,bottom].",
    inputSchema: {},
  },
  async () => {
    const focus = adb(["shell", "dumpsys", "window"]).split("\n").find((l) => l.includes("mCurrentFocus")) || "(unknown)";
    adb(["shell", "uiautomator", "dump", "/sdcard/dump.xml"]);
    const xml = adb(["shell", "cat", "/sdcard/dump.xml"]);
    const elements = [...xml.matchAll(/text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*bounds="(\[[0-9,\[\]]*\])"/g)]
      .filter((m) => m[1] || m[2])
      .map((m) => `text="${m[1]}" id="${m[2]}" bounds=${m[3]}`);
    return text([`focused_window: ${focus.trim()}`, "elements:", ...elements].join("\n"));
  }
);

server.registerTool(
  "adb_screenshot",
  {
    description: "Capture a PNG screenshot of the current screen as evidence. Returns the saved file path.",
    inputSchema: { label: z.string().describe("filename label, e.g. old_after_login") },
  },
  async ({ label }) => {
    const file = path.join(EVIDENCE_DIR, `${label}.png`);
    const buf = execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 1024 * 1024 * 50 });
    fs.writeFileSync(file, buf);
    return text(`saved ${file}`);
  }
);

server.registerTool(
  "adb_logcat_clear",
  { description: "Clear the device logcat buffer, so a subsequent dump only shows fresh events.", inputSchema: {} },
  async () => {
    adb(["logcat", "-c"]);
    return text("logcat cleared");
  }
);

server.registerTool(
  "adb_logcat_dump",
  {
    description: "Dump accumulated logcat since the last clear, filtered to app-relevant priority (warn+), as evidence.",
    inputSchema: { label: z.string() },
  },
  async ({ label }) => {
    const out = adb(["logcat", "-d", "-v", "brief", "*:W"]);
    const file = path.join(EVIDENCE_DIR, `${label}.logcat.txt`);
    fs.writeFileSync(file, out);
    return text(`saved ${file} (${out.split("\n").length} lines)`);
  }
);

server.registerTool(
  "write_report",
  {
    description: "Persist the final regression report (markdown) to disk as evidence/REPORT.md. Call this before requesting release approval.",
    inputSchema: { markdown: z.string() },
  },
  async ({ markdown }) => {
    const file = path.join(EVIDENCE_DIR, "REPORT.md");
    fs.writeFileSync(file, markdown);
    return text(`saved ${file}`);
  }
);

server.registerTool(
  "request_release_approval",
  {
    description:
      "REQUIRED FINAL STEP. Request human sign-off before the release can ship. This tool call itself pauses for human approval (destructive gate) — call it with your final verdict (PASS or REGRESSION_DETECTED) and a one-paragraph summary. Do not skip this even if no regression was found.",
    inputSchema: {
      verdict: z.enum(["PASS", "REGRESSION_DETECTED"]),
      summary: z.string(),
    },
    annotations: { destructiveHint: true, title: "Approve release" },
  },
  async ({ verdict, summary }) => {
    return text(`Human approved release. verdict=${verdict} summary=${summary}`);
  }
);

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`android-release-agent-tools MCP server on http://127.0.0.1:${PORT}/mcp`);
  console.log(`evidence dir: ${EVIDENCE_DIR}`);
});
