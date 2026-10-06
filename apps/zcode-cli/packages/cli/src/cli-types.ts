import type { Logger } from "@zcode/contracts";
import type { RunZCodeProtocolAgentOptions } from "@zcode/bootstrap";
import type { CliEnv, DotenvLoadResult, LoadCliDotenvOptions } from "./env.js";

export type BootstrapModule = typeof import("@zcode/bootstrap");

/**
 * 进程入口的依赖注入面。
 *
 * TUI 与面向人的 CLI 子命令（login / plugins / skills / commands / --prompt / --target）
 * 已随 CLI 产品移除；本进程现在只承担桌面端与远程资产需要的运行时角色：
 * ZCode Protocol 服务端（app-server / agent-server）、插件宿主（plugin-host）、
 * 动态工作流子进程（dwf-child）、内嵌搜索与 hooks 信任管理。
 * 因此这里只保留上述角色真正会读到的注入点，不再有交互层专属依赖。
 */
export interface RunDependencies {
  /** app-server / agent-server 的进程生命周期闸门；由 main 在协议模式下注入。 */
  protocolLifecycle?: RunZCodeProtocolAgentOptions["lifecycle"];
  /** 协议模式的输入流；未注入时回落到 ctx.stdin。 */
  protocolInput?: NodeJS.ReadableStream;
  /** 协议 Agent 的实际启动实现；未注入时经 bootstrap-loader 懒加载。 */
  runZCodeProtocolAgent?: (options: RunZCodeProtocolAgentOptions) => Promise<void>;
  cwd?: () => string;
  env?: CliEnv;
  loadDotenv?: (options?: LoadCliDotenvOptions) => DotenvLoadResult;
  logger?: Logger;
  userConfigPath?: string;
}