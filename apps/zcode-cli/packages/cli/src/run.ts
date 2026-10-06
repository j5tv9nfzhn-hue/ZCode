import { createNodeLoggerFactory } from "@zcode/adapters";
import type { PresentationSurface } from "@zcode/core";
import type { RunContext } from "@zcode/shared-types";
import {
  applyCliRuntimeEnvSanitization,
  loadCliDotenv,
  prepareCliRuntimeEnv,
  shouldLoadCliDotenvForProtocolServer,
} from "./env.js";
import { runHooksCommand } from "./hooks-trust-command.js";
import { loadBootstrapModule } from "./bootstrap-loader.js";
import { runEmbeddedSearchCli } from "./internal-search/embedded-search-cli.js";
import { resolveCliCwd } from "./cwd.js";
import { isPluginHostInvocation, runPluginHostCommand } from "./plugin-host-command.js";
import { isDwfChildInvocation, runDwfChildCommand } from "./dwf-child-command.js";
import type { RunDependencies } from "./cli-types.js";

export type { RunDependencies } from "./cli-types.js";

declare const __CLI_VERSION__: string | undefined;

const version = typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : "0.0.0";

/**
 * 本进程已不再承载任何面向人的 CLI 命令（TUI / --prompt / --target / login /
 * plugins / skills / commands），只剩桌面端与远程资产需要的运行时角色。
 * 因此参数解析只保留这些角色真正消费的开关，stdout 在协议模式下是严格的帧通道。
 */
const PROTOCOL_COMMAND_NAMES = new Set(["app-server", "agent-server"]);

const USAGE = `Usage:
  zcode app-server --stdio [--surface desktop] [--prepare-storage] [--cwd <path>]
  zcode plugin-host <args...>
  zcode dwf-child <args...>
  zcode __internal-search <args...>
  zcode hooks trust <status|review|grant|revoke> [options]
`;

const writeUsage = (stream: NodeJS.WriteStream): void => {
  stream.write(USAGE);
};

const failWithUsage = (stream: NodeJS.WriteStream, message: string): number => {
  stream.write(`${message}\n\n`);
  writeUsage(stream);
  return 1;
};

/** 协议子进程的 presentation surface；桌面 Host 显式传 desktop，其余按 terminal。 */
const resolvePresentationSurface = (value: string | undefined): PresentationSurface => {
  if (value === undefined || value.toLowerCase() === "terminal") return "terminal";
  if (value.toLowerCase() === "desktop") return "zcode_desktop";
  throw new Error(`Unsupported --surface value: ${value}. Supported surfaces: terminal, desktop.`);
};

const runZCodeProtocolCommand = async (
  ctx: RunContext,
  deps: RunDependencies,
  presentationSurface: PresentationSurface,
  prepareStorageOnly: boolean,
): Promise<number> => {
  try {
    const env = prepareCliRuntimeEnv(deps.env ?? process.env);
    const workingDirectory = (deps.cwd ?? process.cwd)();
    // 打包态 app-server 是 desktop host 的内部协议子进程。
    // 如果这里继续从 workspace 向上读取用户 .env，读文件失败或环境污染会在协议建立前
    // 直接退出，外层只能看到 ZCode agent transport closed。
    const dotenvResult = shouldLoadCliDotenvForProtocolServer(env)
      ? (deps.loadDotenv ?? loadCliDotenv)({
          cwd: workingDirectory,
          env,
        })
      : {
          keys: [],
          loaded: false,
        };
    applyCliRuntimeEnvSanitization(env);

    if (dotenvResult.error) {
      throw new Error(`Failed to load environment file: ${dotenvResult.path}`, {
        cause: dotenvResult.error,
      });
    }

    const runProtocolAgent =
      deps.runZCodeProtocolAgent ?? (await loadBootstrapModule()).runZCodeProtocolAgent;
    await runProtocolAgent({
      lifecycle: deps.protocolLifecycle,
      cwd: workingDirectory,
      env,
      input: deps.protocolInput ?? ctx.stdin,
      output: ctx.stdout,
      presentationSurface,
      prepareStorageOnly,
      version,
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.stderr.write(`Error: ${message}\n`);
    if (error instanceof Error && error.stack) {
      ctx.stderr.write(`${error.stack}\n`);
    }
    return 1;
  }
};

export const run = async (ctx: RunContext, deps: RunDependencies = {}): Promise<number> => {
  if (ctx.argv[0] === "__internal-search") {
    return runEmbeddedSearchCli(ctx.argv.slice(1), {
      cwd: (deps.cwd ?? process.cwd)(),
      stderr: ctx.stderr,
      stdin: ctx.stdin,
      stdout: ctx.stdout,
    });
  }

  if (isPluginHostInvocation(ctx.argv)) {
    return await runPluginHostCommand(ctx, ctx.argv.slice(1));
  }

  // 与 plugin host 同理，且必须同样在 parseArgs 之前：SEA 下 dwf 的沙箱子进程是本二进制的
  // 自 re-exec，argv 末位是入口文件路径——交给严格 parseArgs 只会报未知参数。
  if (isDwfChildInvocation(ctx.argv)) {
    return await runDwfChildCommand(ctx, ctx.argv.slice(1));
  }

  if (ctx.argv[0] === "hooks") {
    return runHooksCommand(ctx, deps, version);
  }

  const command = ctx.argv[0] ?? "";
  if (!PROTOCOL_COMMAND_NAMES.has(command)) {
    return failWithUsage(
      ctx.stderr,
      command.length === 0 ? "Missing command." : `Unknown command: ${command}`,
    );
  }

  // 协议子进程的参数面已收窄到运行时必需的开关，因此这里不再走 parseGlobalArgs：
  // 它携带的交互层选项（--prompt/--target/--resume/--mode/插件商店开关等）已随 CLI 产品移除。
  const flag = (name: string): string | undefined => {
    const index = ctx.argv.indexOf(name);
    if (index < 0) return undefined;
    return ctx.argv[index + 1];
  };
  const hasFlag = (name: string): boolean => ctx.argv.includes(name);

  let presentationSurface: PresentationSurface;
  try {
    presentationSurface = resolvePresentationSurface(flag("--surface"));
  } catch (error) {
    return failWithUsage(
      ctx.stderr,
      error instanceof Error ? error.message : String(error),
    );
  }

  let workingDirectory: string;
  try {
    workingDirectory = resolveCliCwd({
      cwd: deps.cwd ?? process.cwd,
      requestedCwd: flag("--cwd"),
    });
  } catch (error) {
    return failWithUsage(
      ctx.stderr,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (hasFlag("--help")) {
    writeUsage(ctx.stdout);
    return 0;
  }
  if (hasFlag("--version")) {
    ctx.stdout.write(`${version}\n`);
    return 0;
  }

  const commandDeps: RunDependencies = {
    ...deps,
    cwd: () => workingDirectory,
    env: prepareCliRuntimeEnv(deps.env ?? process.env),
    logger:
      deps.logger ??
      createNodeLoggerFactory({ env: deps.env ?? process.env }).createLogger("zcode").child({
        module: "cli",
      }),
    loadDotenv: (dotenvOptions = {}) => {
      const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)(dotenvOptions);
      applyCliRuntimeEnvSanitization(dotenvOptions.env ?? process.env);
      return dotenvResult;
    },
  };

  return await runZCodeProtocolCommand(
    ctx,
    commandDeps,
    presentationSurface,
    hasFlag("--prepare-storage"),
  );
};