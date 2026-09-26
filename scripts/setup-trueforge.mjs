#!/usr/bin/env node
// Idempotent setup: registers our MCP tools server, a model provider, and the
// android-release-agent with a locally running TrueForge instance.
//
// Usage:
//   MODEL_PROVIDER=anthropic API_KEY=sk-ant-... node scripts/setup-trueforge.mjs
//   MODEL_PROVIDER=openrouter API_KEY=sk-or-... MODEL_ID=anthropic/claude-haiku-4.5 node scripts/setup-trueforge.mjs
//
// Env vars:
//   TRUEFORGE_BASE   default http://localhost:8790
//   MCP_SERVER_URL   default http://127.0.0.1:8791/mcp
//   MODEL_PROVIDER   "anthropic" | "openrouter" (required)
//   API_KEY          provider API key (required, never printed)
//   MODEL_ID         upstream model id (default depends on provider)
//   MODEL_NAME       local resource slug for the model (default: "default")

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const TRUEFORGE_BASE = process.env.TRUEFORGE_BASE || "http://localhost:8790";
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://127.0.0.1:8791/mcp";
const MODEL_PROVIDER = process.env.MODEL_PROVIDER; // "anthropic" | "openrouter"
const API_KEY = process.env.API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || "default";

if (!MODEL_PROVIDER || !API_KEY) {
  console.error("Set MODEL_PROVIDER (anthropic|openrouter) and API_KEY env vars.");
  process.exit(1);
}

const MODEL_ID =
  process.env.MODEL_ID || (MODEL_PROVIDER === "anthropic" ? "claude-haiku-4-5-20251001" : "anthropic/claude-haiku-4.5");

async function api(method, urlPath, body) {
  const res = await fetch(`${TRUEFORGE_BASE}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function upsertMcpServer() {
  const manifest = {
    type: "remote",
    name: "android-release-agent-tools",
    url: MCP_SERVER_URL,
    description: "APK diffing and Android emulator control tools for autonomous release regression testing",
  };
  const create = await api("POST", "/api/v1/settings/mcp-servers", { manifest });
  if (create.status === 201) {
    console.log("MCP server registered.");
    return;
  }
  if (create.status === 409) {
    await api("PUT", `/api/v1/settings/mcp-servers/android-release-agent-tools`, { manifest });
    console.log("MCP server already existed, updated.");
    return;
  }
  console.error("MCP server registration failed:", create.status, create.json);
  process.exit(1);
}

async function upsertModelProvider() {
  let manifest;
  if (MODEL_PROVIDER === "anthropic") {
    manifest = { type: "anthropic", auth: { api_key: API_KEY }, models: [{ model_id: MODEL_ID, name: MODEL_NAME, properties: {} }] };
  } else if (MODEL_PROVIDER === "openrouter") {
    manifest = {
      type: "custom",
      name: "openrouter",
      base_url: "https://openrouter.ai/api/v1",
      auth: { api_key: API_KEY },
      models: [{ model_id: MODEL_ID, name: MODEL_NAME, properties: {} }],
    };
  } else {
    console.error(`Unsupported MODEL_PROVIDER: ${MODEL_PROVIDER}`);
    process.exit(1);
  }

  const providerName = MODEL_PROVIDER === "anthropic" ? "anthropic" : "openrouter";
  const create = await api("POST", "/api/v1/settings/model-providers", { manifest });
  if (create.status === 201) {
    console.log(`Model provider "${providerName}" registered with model "${MODEL_NAME}" (${MODEL_ID}).`);
  } else if (create.status === 409) {
    await api("PUT", `/api/v1/settings/model-providers/${providerName}`, { manifest });
    console.log(`Model provider "${providerName}" already existed, updated to model "${MODEL_NAME}" (${MODEL_ID}).`);
  } else {
    console.error("Model provider registration failed:", create.status, create.json);
    process.exit(1);
  }
  return `${providerName}/${MODEL_NAME}`;
}

async function upsertAgent(modelFqn) {
  const instructions = fs.readFileSync(path.join(ROOT, "agent-instructions.txt"), "utf8");
  const manifest = {
    model: { name: modelFqn },
    instructions,
    mcp_servers: [
      { name: "android-release-agent-tools", enable_tools: ["@all"], require_approval_for_tools: ["request_release_approval"] },
    ],
    config: { iteration_limit: 120 },
  };

  const list = await api("GET", "/api/v1/agents?agent_name=android-release-agent");
  const existing = list.json?.data?.find((a) => a.name === "android-release-agent");

  if (existing) {
    const upd = await api("PUT", `/api/v1/agents/${existing.id}`, { manifest });
    if (upd.status !== 200) {
      console.error("Agent update failed:", upd.status, upd.json);
      process.exit(1);
    }
    console.log(`Agent "android-release-agent" updated (id=${existing.id}) to use model ${modelFqn}.`);
  } else {
    const create = await api("POST", "/api/v1/agents", {
      name: "android-release-agent",
      description: "Autonomous Android release regression agent: diffs old.apk/new.apk, operates an emulator, and gates release on human approval.",
      manifest,
    });
    if (create.status !== 201) {
      console.error("Agent creation failed:", create.status, create.json);
      process.exit(1);
    }
    console.log(`Agent "android-release-agent" created (id=${create.json.data.id}) using model ${modelFqn}.`);
  }
}

await upsertMcpServer();
const modelFqn = await upsertModelProvider();
await upsertAgent(modelFqn);
console.log("Setup complete.");
