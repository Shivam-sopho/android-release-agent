#!/usr/bin/env node
// Companion CLI for claude-bridge.mjs. TESTING ONLY.

import fs from "node:fs";

const REQUEST_FILE = "/tmp/claude-bridge-request.json";
const RESPONSE_FILE = "/tmp/claude-bridge-response.json";

const [, , cmd, ...rest] = process.argv;

function loadRequest() {
  if (!fs.existsSync(REQUEST_FILE)) {
    console.log("(no pending request)");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(REQUEST_FILE, "utf8"));
}

if (cmd === "peek") {
  const req = loadRequest();
  console.log(`Request ID: ${req.id}`);
  console.log(`--- messages (${req.messages.length}) ---`);
  for (const m of req.messages) {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    console.log(`[${m.role}] ${(content || "").slice(0, 800)}`);
    if (m.tool_calls) console.log(`  tool_calls: ${JSON.stringify(m.tool_calls)}`);
    if (m.tool_call_id) console.log(`  (response to tool_call_id: ${m.tool_call_id})`);
  }
  if (req.tools) console.log(`--- tools available: ${req.tools.map((t) => t.function.name).join(", ")} ---`);
} else if (cmd === "say") {
  const [text] = rest;
  const req = loadRequest();
  fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ id: req.id, content: text }));
  console.log("responded with text");
} else if (cmd === "call") {
  // Shortcut: wraps a real android-release-agent-tools call in TrueForge's
  // call_tool envelope automatically. node bridge.mjs call <tool_name> <inputJson>
  const [toolName, inputJson] = rest;
  const req = loadRequest();
  const callId = `call_${Date.now()}`;
  const wrapped = JSON.stringify({
    mcp_server: "android-release-agent-tools",
    tool_name: toolName,
    input: JSON.parse(inputJson || "{}"),
  });
  fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ id: req.id, tool_calls: [{ id: callId, function: { name: "call_tool", arguments: wrapped } }] }));
  console.log(`responded with call_tool -> ${toolName}(${inputJson || "{}"})`);
} else if (cmd === "tool") {
  const [name, argsJson] = rest;
  const req = loadRequest();
  const callId = `call_${Date.now()}`;
  fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ id: req.id, tool_calls: [{ id: callId, function: { name, arguments: argsJson || "{}" } }] }));
  console.log(`responded with tool call: ${name}(${argsJson || "{}"})`);
} else {
  console.error("Usage: node bridge.mjs <peek|say <text>|tool <name> <argsJson>>");
  process.exit(1);
}
