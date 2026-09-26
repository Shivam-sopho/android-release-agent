# Autonomous Android Release Agent

Give it `old.apk` and `new.apk`. It diffs the **compiled binaries** (not source/PR diffs),
reasons about which user journeys could be affected, drives a real Android emulator to test
them, and stops for a human approval before signing off on release.

Built for the [TrueFoundry × Polaris "Agents That Act" hackathon](https://www.truefoundry.com/truefoundry-hackathon)
(#agentsthatact), community submission track.

## Why

Existing tools (Firebase Test Lab's Robo test, most 2025/2026 AI QA agents) either crawl the UI
with no notion of what changed, or read a **source/PR diff** to decide what to test. Both miss
the case that matters most for release safety: what actually shipped in the binary can diverge
from the source diff (build flags, resource configs, R8/ProGuard, multi-module merges) — and
source-diff tools don't work at all if you don't have the source (QA/release engineering
verifying a build handed to them, or auditing a third-party APK).

This agent starts from the two compiled APKs instead. The hard bet isn't "drive an emulator"
(commodity at this point) — it's turning a binary diff into a targeted test plan.

## Architecture

```mermaid
flowchart LR
    You(["You"]) -->|"upload APKs"| UI["Control panel<br/>(demo-ui)"]
    UI <-->|"session / turns"| TF["TrueForge<br/>(agent harness)"]
    TF <-->|"reasoning"| LLM[("Model provider")]
    TF <-->|"MCP"| MCP["mcp-server<br/>(tools)"]
    MCP <-->|"adb"| EMU["Android<br/>emulator"]
    TF -.->|"approval prompt"| UI
    UI -.->|"Allow / Deny"| TF

    style TF fill:#4f8cff,color:#fff,stroke:#2f6fe0
    style MCP fill:#2ecc71,color:#06210f,stroke:#1f9c56
```

*(dotted = the approval-gate round trip; solid = the main request/response flow)*

Tool calls flow `TrueForge → mcp-server → adb → emulator` and results flow straight back;
`mcp-server` exposes `diff_apks`, `adb_install`/`adb_force_stop`/`adb_launch`/`adb_tap`/
`adb_dump_ui`/`adb_screenshot`/`adb_logcat_*`, `write_report`, and `request_release_approval`.

The **approval gate** is not something we bolted on: `request_release_approval` is registered
in TrueForge's `require_approval_for_tools`, so the harness itself pauses the turn and waits for
an explicit human `allow`/`deny` before the agent can conclude. That's the safety checkpoint the
hackathon's rubric asks for, enforced by the harness, not by agent-side promise-keeping.

### Agent method

```mermaid
flowchart LR
    A["diff_apks\n(compiled binary diff:\nmanifest + per-dex-file\nstring pool + class hashes)"] --> B["Impact analysis\nwhich journeys does\nthis change put at risk?"]
    B --> C["Journey execution\nadb_install / adb_launch /\nadb_tap / adb_dump_ui"]
    C --> D["Evidence capture\nadb_screenshot / adb_logcat_dump"]
    D --> E["write_report"]
    E --> F{"request_release_approval\n— HARD STOP"}
    F -- "human: Allow" --> G(["Release ships"])
    F -- "human: Deny" --> H(["Release blocked"])
```

## Repo layout

- `demo-app/` — demo scenario 1: a minimal Android app (Kotlin, plain Views). Two commits: a
  baseline build, then a one-file regression (`AuthManager.kt` renames its SharedPreferences
  file/keys), which causes existing users to be silently logged out after an in-place app
  upgrade. No crash, no exception — the app just quietly forgets who you are. This is the bug
  the agent is supposed to catch without being told where it is.
- `demo-app-notes/` — demo scenario 2: a small notes app. Same *class* of bug (a
  SharedPreferences file/key rename with no migration on upgrade) hitting a completely different
  feature (saved notes silently vanish instead of a session dropping) — shows the agent reasons
  from the diff each time rather than pattern-matching one specific bug shape.
- `mcp-server/` — the actual tools the agent calls: `diff_apks` (manifest + per-dex-file
  string-pool/class-hash diff between two APKs), `adb_install`/`adb_force_stop`/`adb_launch`/
  `adb_tap`/`adb_dump_ui`/`adb_screenshot`/`adb_logcat_*`, `write_report`,
  `request_release_approval`. Exposed over MCP Streamable HTTP.
  Includes `run-manual-demo.mjs` and `run-notes-demo.mjs`, which call the same tools directly (no
  LLM in the loop) to produce each scenario's `REPORT.md` — used while a model-provider key was
  still being funded — and `live.mjs`, a small CLI for driving the tools live (see "Live mode"
  below).
- `demo-ui/` — the control-panel web app: drop in two APKs, watch the agent's reasoning and tool
  calls stream live, click Allow/Deny on the approval prompt, then open/download the rendered
  report. Auto-detects the real `applicationId` from whatever APK is uploaded (via `aapt dump
  badging`) — it isn't hardcoded to either demo app.
- `scripts/setup-trueforge.mjs` — idempotent script that registers the MCP server, a model
  provider, and the agent with a running TrueForge instance.
- `agent-instructions.txt` — the agent's system prompt / method. App-agnostic by design: it
  reasons from whatever `diff_apks` returns rather than assuming a login/session app.
- `artifacts/` — prebuilt `old.apk`/`new.apk` for demo scenario 1.
- `scenarios/notes-data-loss/` — prebuilt `old.apk`/`new.apk` and `evidence/` for demo scenario 2.

## Prerequisites

- Node.js **22+** (TrueForge's native deps require it; everything else here also runs fine on 22)
- Android SDK with an emulator + at least one AVD (Android Studio's default install location,
  `~/Android/Sdk`, is auto-detected by `adb`/`emulator`)
- An API key for a tool-calling-capable model: Anthropic, or any OpenAI-compatible gateway
  (OpenRouter, TrueFoundry's AI Gateway, etc.)

## Setup

```bash
# 1. Boot an emulator (use any AVD you have)
$ANDROID_HOME/emulator/emulator -avd <your-avd-name> &

# 2. Start the MCP tools server
cd mcp-server && npm install
node server.mjs &

# 3. Start TrueForge (needs Node 22)
npx --yes @truefoundry/trueforge &
# If your network has broken outbound IPv6 (symptom: "Connect Timeout Error" to a model
# provider that works fine with plain curl), also set:
#   NODE_OPTIONS=--dns-result-order=ipv4first
# If TrueForge and the MCP server are both on localhost, also set:
#   OUTBOUND_URL_ALLOWED_HOSTS='["127.0.0.1","localhost"]'
# (TrueForge blocks loopback/private outbound URLs by default — a real SSRF guard, not a bug.)

# 4. Register the model provider, MCP server, and agent
MODEL_PROVIDER=anthropic API_KEY=sk-ant-... node scripts/setup-trueforge.mjs
# or, via OpenRouter:
MODEL_PROVIDER=openrouter API_KEY=sk-or-... MODEL_ID=anthropic/claude-haiku-4.5 node scripts/setup-trueforge.mjs

# 5. Start the control panel
cd demo-ui && npm install
node server.mjs &
```

Open `http://localhost:8792`, drop in `artifacts/old.apk` and `artifacts/new.apk` (or your own
two builds of the same app), click **Run Release Agent**, and approve or deny the release when
prompted.

## Sample runs (real evidence, from before the LLM key was funded)

Two different apps, two different bug shapes, same pipeline — showing the agent reasons from
each diff rather than pattern-matching one specific regression. Both reports include a
**Suggested fix** section: real code grounded in the actual diff, not generic advice.

### Scenario 1 — auth app (silent, no crash)

**[Full report: `evidence/REPORT.md`](evidence/REPORT.md)** — five journeys run against the real
emulator (Login, Login→Kill→Reopen, Login→Logout→Login, a fresh-install sanity check on the new
build, and Existing session→Upgrade→Reopen), each with a verdict, screenshots at every step, UI
dumps, and logcat. A summary table, an impact-analysis section explaining *why* these journeys
were picked from the diff, a root-cause deep-dive, and a suggested fix (with code) for the one
that fails. Driven by [`mcp-server/run-manual-demo.mjs`](mcp-server/run-manual-demo.mjs).

| # | Journey | Result |
|---|---|---|
| J1 | Login | ✅ PASS |
| J2 | Login → Kill app → Reopen | ✅ PASS |
| J3 | Login → Logout → Login | ✅ PASS |
| J4 | Fresh install of new.apk (sanity check) | ✅ PASS |
| J5 | **Existing session → Upgrade → Reopen** | 🔴 **FAIL** |

Precision, not a blanket failure: 4 of 5 journeys pass. Only the one journey the diff actually
implicates — an existing session surviving an in-place upgrade — fails.

| Logged in (old.apk, pre-upgrade) | Bounced to login after upgrading to new.apk |
|---|---|
| ![](evidence/J5_1_old_logged_in.png) | ![](evidence/J5_2_after_upgrade_relaunch.png) |

### Scenario 2 — notes app (visible data loss)

**[Full report: `scenarios/notes-data-loss/evidence/REPORT.md`](scenarios/notes-data-loss/evidence/REPORT.md)**
— same mechanism (a SharedPreferences file/key rename with no migration), different feature: this
time it's the user's saved notes that vanish, not a login session. Driven by
[`mcp-server/run-notes-demo.mjs`](mcp-server/run-notes-demo.mjs).

| Notes saved on old.apk | Gone after upgrading to new.apk |
|---|---|
| ![](scenarios/notes-data-loss/evidence/J1_three_notes_saved.png) | ![](scenarios/notes-data-loss/evidence/J2_after_upgrade.png) |

Try it yourself: drop `scenarios/notes-data-loss/old.apk` and `new.apk` into the control panel —
same UI, same pipeline, a completely different app and bug.

## Live mode

The control panel's purple **"Watch Live Run"** button doesn't go through TrueForge/a model
provider at all — it opens the same event stream and approval-gate UI, but the tool calls are
driven by [`mcp-server/live.mjs`](mcp-server/live.mjs), run by hand, one command per step:

```bash
node mcp-server/live.mjs say "reasoning text"              # a reasoning bubble
node mcp-server/live.mjs call diff_apks '{"old_apk":...}'  # a real tool call + real result
node mcp-server/live.mjs gate PASS "summary"               # the real approval gate; blocks
                                                            # until Allow/Deny is clicked
```

This exists for demoing the harness, the real MCP tools, and the real approval gate without a
funded model-provider key — every tool call is genuine, but a human (not a model) is deciding
which one to make next. It is not an autonomous run, and isn't presented as one.

## Rebuilding the demo app yourself

```bash
cd demo-app
gradle assembleDebug            # builds v1.0 (baseline) — see git log for the injected bug commit
```

The two commits in `demo-app/` show the whole regression: `git log -p -- app/src/main/java`.

## AI-assistant disclosure

Built with [Claude Code](https://claude.com/claude-code) (Anthropic) as a pair-programming
assistant for the full session: architecture decisions, the Android demo app, the MCP tools
server, the TrueForge integration (including discovering and working around two real issues —
TrueForge's outbound SSRF guard blocking loopback URLs, and a broken-IPv6 environment causing
silent connect timeouts to model providers), and the control-panel UI.

## Known limitations

- `diff_apks` diffs the manifest plus, per dex file, string pools and a per-class content hash —
  it correctly handles multidex (an early bug in this project diffed only `classes.dex` and
  silently missed app code that D8 had placed in `classes3.dex`; fixed by diffing every
  `classes*.dex` present in either build). It still isn't a full bytecode decompiler: it tells you
  *which* class changed and what string constants moved, not a semantic method-level diff. Good
  enough to drive journey selection; a production version would want a proper dex differ (e.g.
  `diffuse`) or ProGuard mapping-file-aware diffing for obfuscated release builds.
- The demo app's "journeys" are simple by design (login, upgrade-preserves-session) so the demo
  is legible on camera. The agent isn't limited to a fixed journey catalog — it reasons about
  what to test from the diff — but it's only ever been exercised against this one app.
