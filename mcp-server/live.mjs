#!/usr/bin/env node
// Live-demo driver. Each invocation is one deliberate step, run by hand
// during a live recording — this is Claude Code operating the real MCP
// tools and pushing real events to the control-panel UI, not an autonomous
// script. See README's "Live mode" section for what this is and isn't.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8791/mcp";
const UI_BASE = process.env.UI_BASE || "http://127.0.0.1:8792";
const THREAD_ID = "main";

async function emit(event) {
  await fetch(`${UI_BASE}/api/live/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: THREAD_ID, created_at: new Date().toISOString(), ...event }),
  });
}

async function withClient(fn) {
  const client = new Client({ name: "live-demo", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const [, , cmd, ...rest] = process.argv;

if (cmd === "wait-upload") {
  for (;;) {
    const res = await fetch(`${UI_BASE}/api/live/marker`);
    const { marker } = await res.json();
    if (marker) {
      console.log(JSON.stringify(marker));
      break;
    }
    await wait(1500);
  }
} else if (cmd === "say") {
  const [text] = rest;
  await emit({ type: "model.message", content: text });
} else if (cmd === "call") {
  const [toolName, argsJson] = rest;
  const args = argsJson ? JSON.parse(argsJson) : {};
  const callId = `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await emit({ type: "model.message", tool_calls: [{ id: callId, type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }] });
  const resultText = await withClient(async (client) => {
    const res = await client.callTool({ name: toolName, arguments: args });
    return res.content.map((c) => c.text).join("\n");
  });
  await emit({ type: "tool.response", tool_call_id: callId, content: resultText });
  console.log(resultText);
} else if (cmd === "gate") {
  const [verdict, summary] = rest;
  const callId = `live-gate-${Date.now()}`;
  await emit({
    type: "model.message",
    tool_calls: [{ id: callId, type: "function", function: { name: "request_release_approval", arguments: JSON.stringify({ verdict, summary }) } }],
  });
  await emit({ type: "tool.approval_required", tool_calls: [{ id: callId, source_event_id: callId }] });
  console.error("Waiting for human decision in the browser (Allow/Deny)...");
  for (;;) {
    const res = await fetch(`${UI_BASE}/api/live/decision`);
    const { decision } = await res.json();
    if (decision) {
      if (decision.status === "allow") {
        const resultText = await withClient(async (client) => {
          const res = await client.callTool({ name: "request_release_approval", arguments: { verdict, summary } });
          return res.content.map((c) => c.text).join("\n");
        });
        await emit({ type: "tool.response", tool_call_id: callId, content: resultText });
        await emit({ type: "turn.done", state: { status: "done" } });
        console.log(`ALLOWED: ${resultText}`);
      } else {
        await emit({ type: "tool.response", tool_call_id: callId, content: `Denied by reviewer: ${decision.reason || "no reason given"}` });
        await emit({ type: "turn.done", state: { status: "done" } });
        console.log(`DENIED: ${decision.reason || "no reason given"}`);
      }
      break;
    }
    await wait(1000);
  }
} else if (cmd === "done") {
  await emit({ type: "turn.done", state: { status: "done" } });
} else {
  console.error("Usage: node live.mjs <wait-upload|say|call|gate|done> ...");
  process.exit(1);
}
