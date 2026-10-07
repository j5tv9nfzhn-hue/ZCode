# ZCode（自维护二改分支）

<div align="center">
  <img src="public/logo/icons/1024x1024.png" alt="ZCode" width="128" height="128" />
</div>
<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

> ## 分支定位声明
>
> 本仓库是 ZCode 开源代码的**二次开发自维护分支**：代码基线为上游 **3.14.3**，版本号由本分支自主维护（当前 **3.14.6**）。
>
> - **非官方发行版本**，与上游项目无关联，不继承也不使用其账号体系、服务端点与分发渠道。
> - 相对上游的改动集中在两类：**去官方化**（移除遥测、登录授权、官方模型预设与自动更新绑定）与**低配机性能修复**。完整清单见[本分支相对上游的改动](#本分支相对上游的改动)。
> - **仅本人使用**：不对外分发、不作任何功能或安全承诺、不提供支持。许可与第三方版权仍遵循上游条款，见[项目声明](#项目声明)。
> - 升级方式为**重新构建安装**，不依赖任何自动更新通道。

ZCode 是 AI 编程工作台，本仓库只交付桌面端。浏览器界面与独立终端 Agent 发行产品已移除；`apps/zcode-cli` 保留为桌面端启动的 Agent 运行时源码。

## 更新

- 2026-10-07：自维护分支 **3.14.6** —— 生成完成后 token/s 保持显示收尾时速；修复低配机加载圈被全局动画钳制定格的 bug。
- 2026-10-07：自维护分支 **3.14.5** —— 修复实时指标条速度恒为占位符的根因（采样数据源改用流式行文本增长）。
- 2026-10-07：自维护分支 **3.14.4** —— 去官方化收尾与低配机性能修复（见下方改动清单）。
- 2026-09-23：（上游基线）ZCode v3.14.3。

## 本分支相对上游的改动

### 去官方化

| 改动         | 说明                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 遥测关闭     | `ZCODE_TELEMETRY_ENABLED` 显式置 `false`，4 个出网点全部短路；时区／语言／分辨率等定位字段清空                    |
| 登录授权移除 | WelcomeScreen、API Key 登录表单、OAuth、provider 守卫全部物理删除；首次启动直接进入工作区，模型需在设置页手动配置 |
| 官方预设清空 | Z.ai / BigModel 等官方 Provider 预设置空，兴趣引导（OccupationOnboarding）等 14 个引导文件删除                    |
| 自动更新禁用 | 更新轮询与强制升级 gate 整体关闭；升级改为重新构建安装，不再访问官方 feed                                         |

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

运行时只接受四个入口：`app-server` / `agent-server`（协议服务端，桌面 Host 与远程 stdio 资产使用）、`plugin-host`、`dwf-child`、`__internal-search`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                  | 用途                                     |
| --------------------- | ---------------------------------------- |
| `ZCODE_DATA_BASE_DIR` | 应用数据基目录，数据写入其下的 `.zcode/` |

| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

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

| 目录                                                 | 职责                                                  |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包              |
| `packages/server`                                    | 远程工作区后端（SSH/WSL/Docker）与远程 stdio 服务端   |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态                |
| `packages/services`                                  | 业务服务与持久化                                      |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK            |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现                         |
| `apps/zcode-cli`                                     | Agent 运行时（协议服务端、plugin-host、工作流、工具） |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料                |

## 项目声明

本分支的功能范围、出网行为、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.md](NOTICE.md)。该声明已按本分支的实际代码行为重写：上游原文中描述的登录授权、账号套餐、官方模型网关转发、遥测与自动更新等链路在本分支已不存在，不再作为承诺范围。
