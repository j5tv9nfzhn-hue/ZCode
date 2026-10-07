# ZCode (self-maintained fork)

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

> ## Branch positioning
>
> This repository is a **self-maintained second-party fork** of the ZCode source: the code baseline is upstream **3.14.3**, and the version is maintained independently by this branch (currently **3.14.6**).
>
> - **Not an official release.** It is unaffiliated with the upstream project and neither inherits nor uses its account system, service endpoints, or distribution channels.
> - Changes relative to upstream fall into two categories: **de-officialization** (telemetry, login/authorization, official model presets, and auto-update bindings removed) and **low-spec machine performance fixes**. See [Changes relative to upstream](#changes-relative-to-upstream).
> - **For personal use only**: no external distribution, no functional or security commitments, no support. Licensing and third-party copyright still follow the upstream terms; see [Project Notice](#project-notice).
> - Upgrades are performed by **rebuilding and reinstalling**; no auto-update channel is used.

ZCode is an AI coding workspace. This repository delivers the desktop app only. The browser client and the standalone terminal Agent distribution have been removed; `apps/zcode-cli` remains as the Agent runtime source the desktop app launches.

## Updates

- 2026-10-07: self-maintained branch **3.14.6** — keep token/s visible after a reply completes (frozen final rate); fix low-spec spinners being frozen by the global animation clamp.
- 2026-10-07: self-maintained branch **3.14.5** — fix the root cause of the live metrics rate always showing a placeholder (sampling signal switched to streaming row text growth).
- 2026-10-07: self-maintained branch **3.14.4** — de-officialization wrap-up and low-spec performance fixes (see the change list below).
- 2026-09-23: (upstream baseline) ZCode v3.14.3.

## Changes relative to upstream

### De-officialization

| Change                   | Description                                                                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Telemetry disabled       | `ZCODE_TELEMETRY_ENABLED` explicitly set to `false`, short-circuiting all 4 egress points; timezone / language / resolution fingerprint fields emptied                           |
| Login removed            | WelcomeScreen, API key login form, OAuth, and the provider guard physically deleted; first launch goes straight to the workspace, models must be configured manually in Settings |
| Official presets cleared | Z.ai / BigModel and other official provider presets emptied; 14 onboarding files including OccupationOnboarding deleted                                                          |
| Auto-update disabled     | Update polling and the forced upgrade gate fully disabled; upgrades happen by rebuilding and reinstalling, with no access to the official feed                                   |

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

## Packaging

See [third-party/README.md](third-party/README.md) for notice generation, distribution checks, and where the notices are included in each distribution.

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
| `scripts`, `config`, `third-party`                   | Build and maintenance scripts, built-in configuration, and third-party notice materials |

## Project Notice

See [NOTICE.md](NOTICE.md) for this branch's feature scope, network behavior, execution and data risks, licensing, and third-party copyright information. That notice has been rewritten to match the actual code behavior of this branch: the login/authorization, account plans, official model gateway forwarding, telemetry, and auto-update flows described in the upstream text no longer exist here and are not part of the commitment scope.
