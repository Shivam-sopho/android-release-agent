# Solution Writeup — Autonomous Android Release Agent

**The problem.** Android release testing either crawls the UI blindly (Firebase Test Lab's Robo
test) or reads a source/PR diff to decide what to test. Neither reflects what's actually
shipping — compiled output can diverge from source (build flags, R8/ProGuard, multi-module
merges) — and source-diff tools don't work without source access. This agent diffs the
**compiled APKs** directly and reasons about which user journeys the change actually puts at
risk.

**What it reaches.** Given `old.apk` + `new.apk`, it runs `diff_apks` (manifest + per-dex-file
string-pool + per-class content hash — pinpoints exactly which class changed, no decompiler
needed), designs a short targeted journey list from that diff, drives a real Android emulator via
`adb_*` tools to execute those journeys on both builds, compares outcomes, and writes a report
with a code-level suggested fix grounded in the actual diff.

**Where it stops.** `request_release_approval` is registered in TrueForge's
`require_approval_for_tools`. The harness itself pauses the run and blocks on an explicit human
Allow/Deny before the agent can conclude — a hard stop enforced by the harness, not a promise
from the agent.

**Architecture.** TrueForge (harness: sessions/turns, MCP tool wiring, native approval gates) ↔
our MCP tool server (`diff_apks`, `adb_*`, `write_report`, `request_release_approval`, exposed
over MCP Streamable HTTP) ↔ a live Android emulator. A control-panel UI drops in two APKs and
streams the run.

**How TrueForge was used.** `scripts/setup-trueforge.mjs` registers our MCP server and agent with
a running TrueForge instance via its `/api/v1` REST API. `demo-ui/server.mjs` creates a session
and turn (`POST /api/v1/sessions/{id}/turns`) and proxies the streamed events — including the
approval-gate pause — to the browser.

**Real vs. mocked.** The tools, emulator control, APK diffing, and approval gate are all real —
every screenshot, logcat file, and verdict in `evidence/` and `scenarios/*/evidence/` came from
genuine tool executions against a live emulator, including two independent planted regressions
across two different apps. What's not yet exercised end-to-end: a funded model call driving the
reasoning unattended through TrueForge's turn loop. During development this step was substituted
with a human (Claude Code) issuing the same real tool calls live — disclosed as such throughout
the repo (see `mcp-server/live.mjs`, `run-manual-demo.mjs`, `run-notes-demo.mjs`).

**Known limits.** `diff_apks` is a string-pool/class-hash diff, not a full bytecode decompiler —
enough to point at *which* class changed, not a semantic method-level diff. Journey execution
reasons about real UI element bounds per app (via `adb_dump_ui`) rather than assuming any fixed
layout, but has only been exercised against two intentionally simple demo apps, not a
production-scale UI.
