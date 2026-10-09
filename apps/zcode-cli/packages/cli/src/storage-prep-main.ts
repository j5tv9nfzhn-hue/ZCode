/**
 * `--prepare-storage` 的独立入口。
 *
 * Host 每次冷启动都会为每个预热工作区 fork 一个 Worker 跑存储准备
 * （`packages/desktop/src/host/storagePreparationProcesses.ts:130`）。这个 Worker 过去以
 * 完整的 zcode.cjs 为入口，为了开 SQLite、跑一次迁移、和 Host 握手，
 * 要连带解析承载 core / provider / MCP / ai-sdk 的整包——一次启动最多 3 份。
 *
 * 本入口只保留那条依赖闭包（约 2.7MB 源码，对照全量约 17MB），并由 build.mjs 打成
 * 独立的 zcode.storage-prep.cjs。协议语义与主入口**必须完全一致**，因此这里逐项照搬
 * main.ts 在 prepare-storage 形态下会走的分支，不做任何"简化"：
 * stdout 是严格 JSON 帧通道，少装一个 stderr 边界就会让对端解析崩溃。
 *
 * 详见 apps/zcode-cli/docs/agent-bundle-startup.md。
 */
import { installStderrConsoleBoundary } from "./protocol-console.js";
import { interceptKnownRuntimeWarnings } from "./runtime-warnings.js";
import { applyCliRuntimeEnvSanitization } from "./env.js";
import { installProtocolStderrBoundary } from "./protocol-stderr.js";
import { installCliProcessErrorBoundary } from "./process-errors.js";
import { scheduleCliExitWatchdog } from "./shutdown.js";
import { resolveCliCwd } from "./cwd.js";
import { prepareProtocolEnv, withSanitizingDotenv } from "./protocol-env.js";
import { runProtocolStoragePreparation } from "@zcode/bootstrap/storage-prep";

void main();

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stderr = process.stderr;
  // 与 main.ts 同一顺序：先清洗 shell 注入的变量，再把进程级 console 引导到 stderr。
  // setCliProcessTitle 不装——存储准备跑在 Host Worker 里，改名会影响整个 Host。
  applyCliRuntimeEnvSanitization(process.env);
  installProtocolStderrBoundary(stderr);
  const restoreConsole = installStderrConsoleBoundary(stderr);
  const runtimeWarnings = interceptKnownRuntimeWarnings(stderr);
  const disposeProcessErrorBoundary = installCliProcessErrorBoundary({
    stderr,
    // 存储准备没有 protocolLifecycle（main.ts:24-27 对 --prepare-storage 显式不建），
    // 所以致命错误只能直接退出，与主入口同一条路径。
    onFatal: () => process.exit(1),
  });

  try {
    const requestedCwd = flagValue(argv, "--cwd");
    const workingDirectory = resolveCliCwd({
      cwd: process.cwd,
      requestedCwd,
    });
    // loadDotenv 必须走同一个包装器，否则预热入口与主入口会拿到不同的 env。
    const { env } = prepareProtocolEnv({
      cwd: () => workingDirectory,
      loadDotenv: withSanitizingDotenv({}),
    });
    await runProtocolStoragePreparation({
      cwd: workingDirectory,
      env,
      input: process.stdin,
      output: process.stdout,
    });
    process.exitCode = 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    await waitForPendingWarnings();
    runtimeWarnings.restore();
    disposeProcessErrorBoundary();
    scheduleCliExitWatchdog({ exitCode: normalizeProcessExitCode(process.exitCode) });
    restoreConsole();
  }
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function normalizeProcessExitCode(exitCode: string | number | null | undefined): number {
  if (typeof exitCode === "number" && Number.isInteger(exitCode)) return exitCode;
  if (typeof exitCode === "string") {
    const parsed = Number(exitCode);
    if (Number.isInteger(parsed)) return parsed;
  }
  return 0;
}

function waitForPendingWarnings(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}