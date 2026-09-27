#!/usr/bin/env node
// TESTING TOOL, NOT FOR DEMO. Implements an OpenAI-compatible /v1/chat/completions
// endpoint that TrueForge can be pointed at as a "custom" model provider. Each
// incoming request is written to disk and this process blocks until a human
// (via bridge.mjs) supplies the response — so TrueForge's real turn loop, real
// MCP tool execution, and real approval gate all run for real, but a human is
// answering each "model" call instead of an actual model. See bridge.mjs and
// README notes on what this is and isn't for.

import express from "express";
import fs from "node:fs";

const PORT = process.env.BRIDGE_PORT || 11500;
const REQUEST_FILE = "/tmp/claude-bridge-request.json";
const RESPONSE_FILE = "/tmp/claude-bridge-response.json";

const app = express();
app.use(express.json({ limit: "20mb" }));

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

app.post("/v1/chat/completions", async (req, res) => {
  const reqId = `req-${Date.now()}`;
  fs.writeFileSync(REQUEST_FILE, JSON.stringify({ id: reqId, ...req.body }, null, 2));
  console.log(`[bridge] new request ${reqId} — messages=${req.body.messages?.length ?? 0} tools=${req.body.tools?.length ?? 0}`);

  const start = Date.now();
  for (;;) {
    if (fs.existsSync(RESPONSE_FILE)) {
      const resp = JSON.parse(fs.readFileSync(RESPONSE_FILE, "utf8"));
      if (resp.id === reqId) {
        fs.unlinkSync(RESPONSE_FILE);
        return sendResponse(req.body, resp, res);
      }
    }
    if (Date.now() - start > 30 * 60 * 1000) {
      return res.status(504).json({ error: "bridge timeout waiting for human response" });
    }
    await wait(1000);
  }
});

function sendResponse(reqBody, resp, res) {
  const stream = reqBody.stream !== false;
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${Date.now()}`;

  if (!stream) {
    const message = { role: "assistant", content: resp.content ?? null };
    if (resp.tool_calls) message.tool_calls = resp.tool_calls;
    res.json({
      id,
      object: "chat.completion",
      created,
      model: "claude-bridge",
      choices: [{ index: 0, message, finish_reason: resp.tool_calls ? "tool_calls" : "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const chunk = (delta, finish_reason = null) => {
    res.write(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model: "claude-bridge",
        choices: [{ index: 0, delta, finish_reason }],
      })}\n\n`
    );
  };

  chunk({ role: "assistant" });
  if (resp.content) chunk({ content: resp.content });
  if (resp.tool_calls) {
    resp.tool_calls.forEach((tc, i) => {
      chunk({
        tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: tc.function.arguments } }],
      });
    });
  }
  chunk({}, resp.tool_calls ? "tool_calls" : "stop");
  res.write("data: [DONE]\n\n");
  res.end();
}

app.get("/v1/models", (req, res) => {
  res.json({ object: "list", data: [{ id: "claude-bridge", object: "model" }] });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Claude bridge (TESTING ONLY) listening on http://127.0.0.1:${PORT}/v1`);
});
