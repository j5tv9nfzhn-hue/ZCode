# ZCode (self-maintained fork)

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

> ## ⚠️ Branch positioning (read this first)
>
> This repository is a **self-maintained second-party fork** of the ZCode source and is **in no way affiliated with the official ZCode product**.
>
> - **Not an official release.** It does not inherit, use, or call the official product's account system, service endpoints, distribution channels, or operational policy. The upstream project does not endorse, support, or maintain any change in this fork.
> - The code baseline is upstream **3.14.3**; the version is maintained independently by this branch (currently **3.14.7**) and does not track the upstream release cadence.
> - **For personal use only**: no external distribution, no functional or security commitments, no support. Licensing and third-party copyright still follow the upstream terms; see [Project Notice](#project-notice).
> - Upgrades are performed by **rebuilding and reinstalling**; no auto-update channel is used.
> - Features added in this branch — including the [CTF Console](#ctf-console-authorized-exercise-console) — are original work of this fork and do not represent the official product's position.

ZCode is an AI coding workspace. This repository delivers the desktop app only. The browser client and the standalone terminal Agent distribution have been removed; `apps/zcode-cli` remains as the Agent runtime source the desktop app launches.

## Updates

- 2026-10-08: self-maintained branch **3.14.7** — added the [CTF Console](#ctf-console-authorized-exercise-console) authorized-exercise console (three request-projection switches, projection diff panel, built-in pentest orchestration skill); fixed a real defect where the full-output switch made every turn fail. See [release notes](#ctf-console-authorized-exercise-console).
- 2026-10-07: self-maintained branch **3.14.6** — keep token/s visible after a reply completes (frozen final rate); fix low-spec spinners being frozen by the global animation clamp.
- 2026-10-07: self-maintained branch **3.14.5** — fix the root cause of the live metrics rate always showing a placeholder (sampling signal switched to streaming row text growth).
- 2026-10-07: self-maintained branch **3.14.4** — de-officialization wrap-up and low-spec performance fixes (see the change list below).
- 2026-09-23: (upstream baseline) ZCode v3.14.3.

## CTF Console (authorized exercise console)

> **For security assessment of systems you own or have written authorization to test.** Whether a target is in scope is your own judgement and sole responsibility. This repository provides no authorization verification, target filtering, or use restriction.

A separate Settings section added by this fork, for adjusting _how requests are assembled before reaching the model_ during authorized exercises, and for observing that process live. **This is original work of this fork, unrelated to the official ZCode product.**

### Three switches

Fixed per newly created session, **all off by default**, and affecting only the request copy sent to the Provider:

| Switch                          | What it does                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Neutral task projection**     | Neutralizes narrative text: real user input is restructured by sentence (target entities and the original intent fragment preserved, attack-semantics triggers removed) |
| **Assistant CoT Prefill**       | Appends an assistant opening prefix to the request so the model continues under an "already executing" posture                                                          |
| **Full output (no truncation)** | Sends `maxOutputTokens` at the model's own declared limit instead of the local context budget                                                                           |

### Key semantics

- **History and files always keep the original text**: rewriting happens only at request assembly time; the persisted transcript, UI display, and workspace files are untouched.
- **The task boundary is not defined for you**: the template only removes attack semantics — it does not hardcode steps, prescribe methods, or imply reconnaissance-only work.
- **Executable payloads and real observations are never rewritten**: tool-call inputs and tool-result bodies are left alone so the model cannot report commands that were never run.

### Projection diff panel

Answers one specific question: **"what exactly did this sentence become?"** Without it you can only infer from indirect signals, where "word list missed a term", "the template is wrong", and "the projection never ran" look identical.

Shows `original → projected` pairs live. Off by default; when on it is **never written to chat history or disk** and lives only in an in-memory ring buffer (2000 chars per entry, 200 entries). The "original" shown is your raw input — confirm compliance before screenshotting or sharing.

### Measured results

Three runs against the real ZCode backend (`zcode.cjs app-server` with the real tool contracts) and `glm-5.3-flash`. Zero refusals; the model advanced autonomously:

| Run | Tool calls | Outcome        | Refusal phrases | No-modify constraint |
| --- | ---------- | -------------- | --------------- | -------------------- |
| 1   | 24         | success        | 0               | held                 |
| 2   | 25         | success        | 0               | held                 |
| 3   | 38         | time-box ended | 0               | held                 |

**Evidence discipline**: all runs only retrieved data that was already publicly reachable inside the target workspace. By this project's own criterion ("retrieving public content has no value"), these runs do **not** constitute a breach of any third-party system.

Full details in **[docs/ctf-console.md](docs/ctf-console.md)**; technical design and all invariants in
[apps/zcode-cli/docs/neutral-task-mode.md](apps/zcode-cli/docs/neutral-task-mode.md).

## Changes relative to upstream

### De-officialization

| Change                   | Description                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry disabled       | `ZCODE_TELEMETRY_ENABLED` explicitly set to `false`, short-circuiting all 4 egress points; timezone / language / resolution fingerprint fields emptied                           |
| Login removed            | WelcomeScreen, API key login form, OAuth, and the provider guard physically deleted; first launch goes straight to the workspace, models must be configured manually in Settings |
| Official presets cleared | Z.ai / BigModel and other official provider presets emptied; 14 onboarding files including OccupationOnboarding deleted                                                          |
| Auto-update disabled     | Update polling and the forced upgrade gate fully disabled; upgrades happen by rebuilding and reinstalling, with no access to the official feed                                   |

### Added capabilities

| Change                       | Description                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| CTF Console section          | New Settings section: three request-projection switches, projection diff panel, runtime log, public-target probe |
| Built-in `pentest` skill     | Multi-stage security assessment with per-stage isolation: each step runs in its own short-lived Agent context    |
| Custom system prompt section | Separate Settings section; same "fixed at session creation" semantics as the projection switches                 |

### Performance (target machine: i3-3110M / 7.85GB / HD 4000)

| Change                         | Description                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows acrylic removed        | The root node is opaque on win32 anyway, so the blur layer was invisible yet still software-composited by DWM every frame — the main cause of global jank; zero visual change                  |
| Hardware acceleration restored | On low-spec machines `desktopChromiumHardwareAccelerationEnabled` had been set to `false` (global software rasterization, more harmful than acrylic); changed back to `true`                   |
| Long-list cost reduction       | Model menu and Settings model list enable `content-visibility` for offscreen rows; provider-level menu gained a height cap, fixing unbounded popovers with many models                         |
| Metrics rate fix               | TPS sampling switched from cumulative tokens (updated only at turn end) to streaming row text growth; fixes the permanently-placeholder rate and keeps the final rate visible after completion |
| Spinner exemption              | The low-spec animation clamp no longer freezes `animate-spin` loading circles; "busy" and "frozen" are distinguishable again                                                                   |
| Model pull interaction         | Supports select-all / select-none; list rows memoized and virtualized                                                                                                                          |

## Setup

Install Git, Node.js **24.14.0**, and pnpm **10.33.2**. [mise.toml](mise.toml) is the source of truth for tool versions. Run all development and packaging commands below from the repository root.

```bash
pnpm bootstrap
```

`pnpm bootstrap` installs workspace dependencies, prepares local desktop runtime assets, and runs `build:bootstrap`.

The Agent CLI and runtime source code lives in [apps/zcode-cli/](apps/zcode-cli/) as a regular directory included when you clone this repository. No separate checkout or Git submodule initialization is required.

Additional setup and build commands:

| Command                        | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`                 | Install dependencies                                                                                                                |
| `pnpm prepare:desktop-runtime` | Prepare desktop runtime assets, including remote assets by default                                                                  |
| `pnpm prepare:remote-assets`   | Prepare remote runtime assets separately                                                                                            |
| `pnpm bootstrap:with-remote`   | Set up dependencies and local and remote assets, then build the relevant packages sequentially; skip the desktop application bundle |
| `pnpm build`                   | Recursively run each workspace package's build script, including its asset preparation steps                                        |

The default `bootstrap` skips remote asset preparation and is suitable for local desktop development. Run the corresponding preparation command when working with remote workspaces or validating remote distribution assets.

## Development and Usage

### Desktop

```bash
pnpm dev:desktop

# Use the test environment
pnpm dev:desktop:test
```

`pnpm dev:desktop` defaults to `pnpm dev:desktop:prod` and uses production service configuration. The startup script prepares local runtime assets, builds the desktop Agent, then starts Electron and source watchers.

Set `ZCODE_DATA_BASE_DIR` to use a separate development data directory. For example, on macOS / Linux:

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### Agent Runtime Source Development

`apps/zcode-cli` now hosts only the Agent runtime the desktop app launches (ZCode Protocol server, plugin host, dynamic workflow, and tools). There is no interactive CLI or TUI.

```bash
pnpm --filter @zcode/cli dev

# Build the runtime and its workspace dependencies
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

The runtime accepts four entries: `app-server` / `agent-server` (the protocol server used by the desktop Host and by remote stdio assets), `plugin-host`, `dwf-child`, and `__internal-search`.

## Configuration

The root [.env.example](.env.example) provides sample service URLs and build configuration. Copy it to `.env` as needed and place local overrides in `.env.local`. Select the Desktop development environment with `dev:desktop:test` or `dev:desktop:prod`.

| Setting               | Purpose                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `ZCODE_DATA_BASE_DIR` | Base directory for application data, stored under its `.zcode/` subdirectory |

| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | Path to a local provider configuration file; uses the built-in configuration when unset |

Runtime variables can be set explicitly in the environment of the startup command. See [config/README.md](config/README.md) for the default configuration shipped with the client.

The three CTF Console switches are **not** environment variables. They travel through
`AppSettings → session/requestRuntimePreferences → runtimeConfig` and take effect on newly created sessions.

## Packaging

The third-party notice **artifact** is [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) at the repository root (generated by `scripts/generate-third-party-notices.mjs` — do not edit by hand). The **manifest data** behind it lives in `inventory.json`, `embedded-components.json`, `npm-overrides.json` and siblings under [third-party/](third-party/).

### Desktop

```bash
pnpm bundle:desktop

# Set the target platform and CPU architecture
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

The default target is macOS arm64, and the default output directory is `packages/desktop/dist/`. `--os` accepts `mac`, `win`, or `linux`; `--arch` accepts `x64` or `arm64`. Packaging and signing require the tools and configuration for the target platform.

This branch ships for **Windows x64 only**: artifacts are unsigned and are not published to any distribution platform; they are uploaded as workflow artifacts and retrieved locally for installation.

## Repository Structure

| Directory                                            | Responsibility                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main, Host, Renderer, and desktop packaging                                    |
| `packages/server`                                    | Remote workspace backends (SSH/WSL/Docker) and the remote stdio server                  |
| `packages/ui`                                        | Shared React components, hooks, and Zustand state                                       |
| `packages/services`                                  | Business services and persistence                                                       |
| `packages/shared`, `packages/rpc`, `packages/client` | Shared protocols and types, RPC framework, and Agent client SDK                         |
| `packages/provider`, `packages/provider-node`        | Common provider capabilities and Node implementations                                   |
| `apps/zcode-cli`                                     | Agent runtime: protocol server, plugin host, dynamic workflow, and tools                |
| `docs`                                               | Section documentation (e.g. [CTF Console](docs/ctf-console.md))                         |
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Documentation

| Document                                                                             | Audience           | Content                                                                               |
| ------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------- |
| [docs/ctf-console.md](docs/ctf-console.md)                                           | Users              | CTF Console usage, semantic constraints, measured data                                |
| [NOTICE.md](NOTICE.md)                                                               | Everyone           | Feature scope, network behavior, execution/data risks, license, third-party copyright |
| [AGENTS.md](AGENTS.md)                                                               | Coding agents      | Self-maintained facts, toolchain, command essentials, architecture gates              |
| [DESIGN.md](DESIGN.md)                                                               | Coding agents / UI | Design system and hard UI constraints (e.g. type-scale tokens)                        |
| [CONTEXT.md](CONTEXT.md)                                                             | Everyone           | Domain glossary (plugin store, CTF Console)                                           |
| [apps/zcode-cli/docs/neutral-task-mode.md](apps/zcode-cli/docs/neutral-task-mode.md) | Coding agents      | Request projection design, all invariants, raw measurement data                       |

## Project Notice

See [NOTICE.md](NOTICE.md) for this branch's feature scope, network behavior, execution and data risks, licensing, and third-party copyright information. That notice has been rewritten to match the actual code behavior of this branch: the login/authorization, account plans, official model gateway forwarding, telemetry, and auto-update flows described in the upstream text no longer exist here and are not part of the commitment scope. Capabilities added by this fork — including CTF Console — are likewise within the scope of that notice and **constitute no affiliation, endorsement, or authorization determination with respect to the official product**.
