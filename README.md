# ZCode（自维护二改分支）

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  简体中文（本分支唯一入口；2026-10-09 起删除已漂移的英文镜像）
</p>

> ## ⚠️ 分支定位声明（请先读这一段）
>
> 本仓库是 ZCode 开源代码的**二次开发自维护分支**，**与上游官方 ZCode 无任何关联**。
>
> - **非官方发行版本**。不继承、不使用、不调用官方产品的账号体系、服务端点、分发渠道与运营策略；官方不认可、不背书、不维护本分支的任何改动。
> - 代码基线为上游 **3.14.3**，版本号由本分支自主维护（当前 **3.14.11**），不追随上游版本节奏。
> - **仅本人使用**：不对外分发、不作任何功能或安全承诺、不提供支持。
> - 许可与第三方版权仍遵循上游条款，见 [项目声明](#项目声明)。
> - 升级方式为**重新构建安装**，不依赖任何自动更新通道。
> - 本分支新增的功能（含 [CTF Console](#ctf-console授权演练控制台)）均为本分支自有改动，不代表官方产品立场。

ZCode 是 AI 编程工作台，本仓库只交付桌面端。浏览器界面与独立终端 Agent 发行产品已移除；`apps/zcode-cli` 保留为桌面端启动的 Agent 运行时源码。

## 更新

- 2026-10-10：自维护分支 **3.14.11** —— 修复两处导致 CTF Console 不可用的缺陷：（1）设置页打开即崩溃（React #310，`CtfConsoleOrchestrationPanel` 的 `useMemo` 放在 early return 之后，overview 从 undefined 变为有值时 hook 数量变化）；（2）开启编排开关后模型仍不走编排身份（草稿预热会话在设置变更前已创建，`pentestOrchestrationEnabled` 等按-session-固定开关冻结在旧值；现与 `modelSelectionView.revision` 同款处理——开关变化时回收未发送的预热会话并按新值重建）。

- 2026-10-10：自维护分支 **3.14.10** —— 移除中性任务投影路线（外部破甲改走编排层）；修复渗透编排三处致命缺陷（意图永卡 running 的空转死锁、worker 未继承产物端口、`maxTurns` 死配置）；修复编排子代理固定 `parentToolCallId` 导致的"重启/从头运行"；前端渲染热点优化（模型选择器 memo 化、任务列表 selector 去序列化）；设置页 lazy 化；冷启动三段 I/O 并行化。

- 2026-10-09：自维护分支 **3.14.9** —— 桌面启动成本与体积优化（V8 字节码接入默认打包链、`--prepare-storage` 拆出瘦身入口、bash 注册表惰性物化），修复内嵌浏览器被强制套设备模拟画布、Windows 右键菜单冷启动阻塞；原生联网搜索补上 openai 覆盖面。

- 2026-10-08：自维护分支 **3.14.8** —— 修复输入侧请求投影残留攻击目标语义（§1.7 三处失效）：输入侧重构产物改为零攻击语义词的中性任务书，词表替换值脱敏，新增产物自检与保守模板兜底。

- 2026-10-08：自维护分支 **3.14.7** —— 新增 [CTF Console](#ctf-console授权演练控制台) 授权演练控制台（请求投影三机制 + 投影 diff 调试面板 + 内置 pentest 编排技能）；修复完整输出开关一开即全盘失败的真缺陷。详见 [发布说明](#ctf-console授权演练控制台)。
- 2026-10-07：自维护分支 **3.14.6** —— 生成完成后 token/s 保持显示收尾时速；修复低配机加载圈被全局动画钳制定格的 bug。
- 2026-10-07：自维护分支 **3.14.5** —— 修复实时指标条速度恒为占位符的根因（采样数据源改用流式行文本增长）。
- 2026-10-07：自维护分支 **3.14.4** —— 去官方化收尾与低配机性能修复（见下方改动清单）。
- 2026-09-23：（上游基线）ZCode v3.14.3。

## CTF Console（授权演练控制台）

> **仅供对自有或已获书面授权的系统进行安全评估。** 是否属于授权范围由使用者自行判断并承担全部责任。本仓库不提供授权认定、目标筛选或用途限制。

本分支新增的独立设置分区，用于在授权演练场景下调整「发往模型的请求如何被组装」，并实时观测这一过程。**这是本分支自有功能，与官方 ZCode 无关。**

### 六个开关

按新建会话固定，**默认全部关闭**，只影响发往 Provider 的那一份请求副本：

| 开关                   | 作用                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| **思维链预填 Prefill** | 请求末尾追加 assistant 起始前缀，让模型在「已开始执行」的预设下续写                                     |
| **完整输出（不截断）** | 按模型自身声明的上限下发 `maxOutputTokens`，不受本地上下文预算截断                                      |
| **渗透编排**           | 注册结构化编排工具与三个编排子代理（goals / planner / worker），并把身份行换成无授权核验框架的 CTF 版本 |

### 关键语义

- **历史与文件永远保留原文**：只在组装请求的那一刻做投影，落盘 transcript、UI 展示、工作区文件都不变。
- **授权判断不在模型职责内**：执行作用域由结构化状态（`po_scope` 表）承载，模型只执行，不做授权核验。
- **不改可执行载荷与真实观测**：tool-call 的入参、tool-result 正文不改写，避免模型复述不存在的命令。

### 观测面板

覆盖度与探索图/产物面板展示编排进度与战果，均**不写入聊天记录、不落盘**。

### 实测数据

真实 ZCode 后端（`zcode app-server` + 真实工具契约）与 `glm-5.3-flash` 上三轮测试：工具调用 24 / 25 / 38 次，**拒绝话术 0 次**，终态 success / success / 时间盒结束，「禁改约束」全部守住。取回内容均为目标工作区内已公开可访问的数据，按「取回公开内容即无破甲价值」的自定判据，这些轮次不构成对任何第三方系统的突破。完整三轮表格与取证纪律见 [docs/ctf-console.md](docs/ctf-console.md)。

权威手册见 **[docs/ctf-console.md](docs/ctf-console.md)**，编排层不变量见
[apps/zcode-cli/docs/pentest-orchestration.md](apps/zcode-cli/docs/pentest-orchestration.md)。
请求投影层已废弃，历史与教训见 [apps/zcode-cli/docs/neutral-task-mode.md](apps/zcode-cli/docs/neutral-task-mode.md)。

## 本分支相对上游的改动

### 去官方化

| 改动         | 说明                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 遥测关闭     | `ZCODE_TELEMETRY_ENABLED` 显式置 `false`，4 个出网点全部短路；时区／语言／分辨率等定位字段清空                    |
| 登录授权移除 | WelcomeScreen、API Key 登录表单、OAuth、provider 守卫全部物理删除；首次启动直接进入工作区，模型需在设置页手动配置 |
| 官方预设清空 | Z.ai / BigModel 等官方 Provider 预设置空，兴趣引导（OccupationOnboarding）等 14 个引导文件删除                    |
| 自动更新禁用 | 更新轮询与强制升级 gate 整体关闭；升级改为重新构建安装，不再访问官方 feed                                         |

### 新增能力

| 改动                  | 说明                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CTF Console 控制台    | 设置页独立分区：6 个开关（投影 / CoT 预填 / 完整输出 / 投影 diff 捕获 / assistant 侧捕获 / 渗透编排）+ 授权目标白名单，面板含投影 diff、运行时日志、覆盖度、编排图与产物、投影预览                                      |
| 内置 pentest 编排技能 | 多阶段安全评估按阶段隔离编排：每步跑在独立短命 Agent 上下文，聚合状态存在证据图（`po_node`/`po_edge`）里，不进模型上下文。机制说明见 [docs/pentest-orchestration-mechanism.md](docs/pentest-orchestration-mechanism.md) |
| 自定义系统提示词分区  | 独立设置分区，与请求投影开关同为「会话创建时固定」语义                                                                                                                                                                  |

### 性能（目标机型：i3-3110M / 7.85GB / HD 4000）

| 改动               | 说明                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Windows 亚克力移除 | 根节点在 win32 本就不透明，模糊层不可见却仍由 DWM 每帧软件合成——全局卡顿主因；移除后视觉零变化                        |
| 硬件加速恢复       | 低配机上 `desktopChromiumHardwareAccelerationEnabled` 曾被置 `false`（全局软件光栅化，比亚克力更致命），已改回 `true` |
| 长列表降本         | 模型菜单与设置页模型列表对屏外行启用 `content-visibility`；provider 级菜单补高度上限，修复模型多时弹层无界溢出        |
| 指标条速度修复     | TPS 采样从「回合结束才更新的累计 token」改为流式行文本增长；修复速度恒显占位符，并让完成后保持显示收尾时速            |
| 加载圈豁免         | 低配机动画钳制不再冻结 `animate-spin` 加载圈，「在忙」与「卡死」不再不可区分                                          |
| 拉取模型交互       | 支持全选／全不选；列表行组件 memo 化 + 虚拟化                                                                         |

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent 运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Agent 运行时源码开发

`apps/zcode-cli` 现在只承载桌面端启动的 Agent 运行时（ZCode Protocol 服务端、plugin-host、动态工作流与工具），没有面向人的交互式 CLI 或 TUI。

```bash
# 运行源码入口
pnpm --filter @zcode/cli dev

# 构建运行时及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

运行时只接受五个入口：`app-server` / `agent-server`（协议服务端，桌面 Host 与远程 stdio 资产使用）、`plugin-host`、`dwf-child`、`__internal-search`、`hooks trust`。

测试入口以各包 `package.json` 为准。行为变更的常用入口：

```bash
pnpm typecheck                                    # 全量类型检查
pnpm test                                         # 根测试（packages/*/test）
pnpm --filter @zcode/core test                    # Agent 运行时测试
pnpm architecture:check --changed                 # 架构边界（改动模块）
pnpm verify:pre-push                              # 推送前快检
```

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                  | 用途                                     |
| --------------------- | ---------------------------------------- |
| `ZCODE_DATA_BASE_DIR` | 应用数据基目录，数据写入其下的 `.zcode/` |

| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

CTF Console 的三个开关**不通过环境变量控制**，而是走
`AppSettings → session/requestRuntimePreferences → runtimeConfig`，按新建会话生效。

## 打包

第三方声明的**产物**是根目录 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（由 `scripts/generate-third-party-notices.mjs` 生成，勿手工编辑）；声明的**清单数据**在 [third-party/](third-party/) 下的 `inventory.json`、`embedded-components.json`、`npm-overrides.json` 等文件。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

自维护分支的交付目标固定为 **Windows x64**：产物不做代码签名，也不发布到任何分发平台，仅作为 workflow artifact 上传后取回本地安装。

安装：双击打开产物 DMG，将 ZCode 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/ZCode.app
```

## 仓库结构

| 目录                                                 | 职责                                                      |
| ---------------------------------------------------- | --------------------------------------------------------- |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包                  |
| `packages/server`                                    | 远程工作区后端（SSH/WSL/Docker）与远程 stdio 服务端       |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态                    |
| `packages/services`                                  | 业务服务与持久化                                          |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK                |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现                             |
| `packages/model-option-map`                          | 模型能力选项映射                                          |
| `apps/zcode-cli`                                     | Agent 运行时（协议服务端、plugin-host、工作流、工具）     |
| `docs`                                               | 分区文档（[CTF Console](docs/ctf-console.md) 为权威手册） |
| `scripts`、`config`                                  | 构建维护脚本与内置配置                                    |

## 项目文档

| 文档                                                                                         | 面向对象        | 内容                                                   |
| -------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------ |
| [docs/ctf-console.md](docs/ctf-console.md)                                                   | 使用者          | CTF Console 使用说明、语义约束、实测数据               |
| [NOTICE.md](NOTICE.md)                                                                       | 所有人          | 功能范围、出网行为、执行与数据风险、许可与第三方版权   |
| [AGENTS.md](AGENTS.md)                                                                       | 编码 Agent      | 本分支自维护事实、工具链、命令要点、架构门禁与既有债务 |
| [DESIGN.md](DESIGN.md)                                                                       | 编码 Agent / UI | 设计系统与 UI 硬约束（字号 token 等）                  |
| [CONTEXT.md](CONTEXT.md)                                                                     | 所有人          | 插件商店领域词汇表                                     |
| [apps/zcode-cli/docs/pentest-orchestration.md](apps/zcode-cli/docs/pentest-orchestration.md) | 编码 Agent      | 编排层技术设计、全部不变量与实测原始数据               |

## 项目声明

本分支的功能范围、出网行为、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。该声明已按本分支的实际代码行为重写：上游原文中描述的登录授权、账号套餐、官方模型网关转发、遥测与自动更新等链路在本分支已不存在，不再作为承诺范围；本分支新增的 CTF Console 等能力同样在声明范围内，**不构成对官方产品的关联、背书或授权认定**。
