# AGENTS.md（仓库根）

自维护二改分支的通用规则。`apps/zcode-cli` 内的详细工作规范见 [apps/zcode-cli/AGENTS.md](apps/zcode-cli/AGENTS.md)，本文件只记录跨仓库的事实与该踩的坑。

## 分支定位（勿回退）

- 代码基线为上游 3.14.x，版本号由本分支自主维护。相对上游做了**去官方化**：遥测常关（`ZCODE_TELEMETRY_ENABLED=false`）、登录 / OAuth / WelcomeScreen 物理删除、官方 Provider 预设置空、自动更新整体关闭。看到这些链路"缺失"不是 bug，不要恢复；升级方式是重新构建安装。
- 本分支新增 **CTF Console**（授权演练控制台）与内置 `pentest` 编排技能，均为本分支自有功能，**与官方产品无关联**。对外表述统一用"本分支自有改动 / 非官方发行版本"，不要写成官方特性，也不要暗示官方认可。风险边界见 [NOTICE.md](NOTICE.md) 的「关于 CTF Console 的专门风险声明」。
- 交付目标固定为 **Windows x64** 未签名产物（仅 workflow artifact）。CI 锁死 windows-2022 且禁止 matrix：node-pty 的 postinstall 按平台重建原生模块，跨平台装出的二进制与交付物不是同一份。`.github/actions/setup-zcode` 会对所有 job 机械强制这一约束。

## 工具链与初始化

- Node 24.14.0 / pnpm 10.33.2，以 [mise.toml](mise.toml) 为唯一权威（CI 从中读取并校验一致）。Electron 走 mise `[env]` 里的 npmmirror 镜像；直接下载 Electron 失败时补 `ELECTRON_MIRROR`。
- 初始化在仓库根跑 `pnpm bootstrap`（install + 桌面运行资源 + `build:bootstrap`，默认跳过远程资源）；SSH/WSL 远程功能用 `pnpm bootstrap:with-remote`。`apps/zcode-cli` 是普通目录，不是 submodule。

## 命令要点

- 格式化器是 **oxfmt**（`pnpm fmt` / `pnpm fmt:check`），linter 是 **oxlint**。仓库里有 `.prettierignore`，但工具链不用 prettier / eslint，别再引入。
- `pnpm typecheck` = `tsc -b` project references（含 desktop host）+ apps/zcode-cli 的 turbo typecheck，冷启动慢属正常。zcode-cli 的 lint 需单独跑 `pnpm --dir apps/zcode-cli lint`。
- 根 `pnpm test` 只覆盖 `packages/*/test/*.test.ts`（目前仅 ui、services 两处）。跑单个文件直接复用同一条命令并把 glob 换成具体路径：
  `tsx --tsconfig packages/ui/tsconfig.json --test packages/services/test/agentProcessCap.test.ts`
- apps/zcode-cli 没有统一测试入口，验证靠 `pnpm --dir apps/zcode-cli check`（registry:check + typecheck）与各包自身 scripts。唯一有测试入口的例外是 core：`pnpm --filter @zcode/core test`（Node 24 原生类型擦除直接跑 `.ts`；新增测试文件要同步登记进该脚本）。
- 推送前快检：`pnpm verify:pre-push`（lint → architecture:check --changed）。CI 完整顺序：fmt:check → lint → typecheck → test → architecture:check。
- 桌面开发用 `pnpm dev:desktop:test`（隔离环境 + 独立数据目录）；裸 `pnpm dev:desktop` 默认走 prod 服务配置。需要独立数据目录时设 `ZCODE_DATA_BASE_DIR`（应用数据写入其下的 `.zcode/`）。
- 打包默认目标是 macOS arm64，交付前必须显式指定：`pnpm bundle:desktop -- --os win --arch x64`。

## 架构门禁与既有债务

- [architecture-policy.yaml](architecture-policy.yaml) + `.architecture-baseline.json`：存量模块多为 legacy（`managed: false`），但**新模块 / 新增跨模块交互**必须守边界（禁深导入、禁环、单文件 ≤ 400 行；目前仅 `storage` 是 managed 模块，公开入口是其 `contract.ts`）。改动后跑 `pnpm architecture:check --changed`；基线迁移后用 `architecture:baseline:update` 更新。详见 `.agents/skills/architecture-governance`。
- `pnpm knip` 在 CI 中故意不阻塞：有 500+ 项既有未使用导出 / 类型 / 依赖。其中 ssh2、node-forge 一类是运行时动态 require，knip 静态分析看不到——只按 knip 报告"清理未用依赖"会让产物启动崩溃。

## 依赖与生成物

- 根 package.json 的 `pnpm.patchedDependencies` 给 3 个上游包打补丁（@arms/rum-electron、@ai-sdk/openai-compatible、@ai-sdk/anthropic）。升级这些包时必须同步核对 patch。
- apps/zcode-cli 的 bash 命令 registry 是生成代码：改动相关逻辑后先 `pnpm --dir apps/zcode-cli registry:generate` 再 check；dynamic-workflow 包的 typecheck 会先跑自己的 `generate-libs.mjs`。

## 配置与环境

- 端点配置分层：`.env.example` → 复制到 `.env`，本地覆盖放未跟踪的 `.env.local`；根目录 `.env.development` / `.env.production` 是随发布的配置，dev 脚本按 `ZCODE_ENV=test|production` 选择。项目自有环境变量一律 `ZCODE_` 前缀且勿随便新增（先写进 spec，见 CLI AGENTS.md）。

## 结构与真实入口

- `packages/desktop`：Electron Main / Host / Renderer 与桌面打包。`packages/server`：远程工作区后端（SSH/WSL/Docker）与远程 stdio 服务端。`packages/ui`：共享 React 组件、hooks、Zustand。`packages/services`：业务服务与持久化（内含 session、storage 子模块）。`packages/rpc|shared|client|provider|provider-node`：协议与类型、RPC 框架、Agent 客户端 SDK、Provider 能力。
- `apps/zcode-cli`：桌面端启动的 Agent 运行时，**没有面向人的交互式 CLI / TUI**。运行时只接受 `app-server` / `agent-server`（协议服务端）、`plugin-host`、`dwf-child`、`__internal-search`、`hooks trust` 这几类入口，不要给它加新顶层命令形态。

## 提交与发布

- 提交信息必须用 Conventional Commits（`feat:` / `fix:` / `chore(release):`…）：CHANGELOG 由 release-it + conventional-changelog 从提交信息生成。版本号自主维护，不追随上游。

## 其他指令来源

- [apps/zcode-cli/AGENTS.md](apps/zcode-cli/AGENTS.md)：spec-first、单文件 ≤ 400 行、外部 I/O 收敛到 adapter、traceId 全链传播、提交拆分规则——触碰 apps/zcode-cli 前必读。
- [DESIGN.md](DESIGN.md)：应用 UI 字号强制走 `text-ui-*` token（代码 / Diff / 终端除外），违反按缺陷处理，不要即兴发明视觉规则。**颜色同理**：只有 `packages/ui/src/styles.css` 里真实定义的 `--color-*` 才会生成工具类，凭空取名（如 `border-warning-border`）会静默无样式；彩色文字用 `text-warning`/`text-success`/`text-destructive` 而非给实底徽标配的 `-foreground` 变体；增删行用专用 `text-diff-added`/`text-diff-removed`，不要借 success/destructive。
- [CONTEXT.md](CONTEXT.md)：领域词汇表（插件商店 + CTF Console），涉及这两块的文档与命名先对齐该表。
- [docs/ctf-console.md](docs/ctf-console.md)：CTF Console 的使用者视角说明（开关语义、约束、实测数据）。
- [apps/zcode-cli/docs/pentest-orchestration.md](apps/zcode-cli/docs/pentest-orchestration.md)：CTF Console 编排层（goals/planner/worker 三角色 + 结构化产物工具 + CTF 身份行）的不变量；触碰 `runtime/pentest/`、`subagent/pentest-*` 或 `runtimeConfig.pentestOrchestrationEnabled` 时按它验收。
