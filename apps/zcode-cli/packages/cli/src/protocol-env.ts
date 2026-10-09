import {
  applyCliRuntimeEnvSanitization,
  loadCliDotenv,
  prepareCliRuntimeEnv,
  shouldLoadCliDotenvForProtocolServer,
  type CliEnv,
} from "./env.js";
import type { RunDependencies } from "./cli-types.js";

export interface ProtocolEnvPreparation {
  env: CliEnv;
  workingDirectory: string;
}

/**
 * 协议子进程（app-server / agent-server，含 `--prepare-storage`）共用的环境准备段。
 *
 * 抽出来是因为 storage-prep 独立入口与主入口必须跑完全相同的环境逻辑：
 * 两份实现迟早会漂移，而漂移的后果是「主入口能连上远端、预热入口连不上」这类难查的问题。
 * 实现是从 run.ts 的 runZCodeProtocolCommand 原样搬移，语义不得改动。
 */
export function prepareProtocolEnv(deps: RunDependencies): ProtocolEnvPreparation {
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
  return { env, workingDirectory };
}

/**
 * 主入口在装配 commandDeps 时给 loadDotenv 套的那层「加载后再清洗一次」。
 * 独立入口没有 run.ts 的 commandDeps，必须用同一个包装器才能得到同样的 env 结果。
 */
export function withSanitizingDotenv(
  deps: RunDependencies,
): RunDependencies["loadDotenv"] {
  return (dotenvOptions = {}) => {
    const dotenvResult = (deps.loadDotenv ?? loadCliDotenv)(dotenvOptions);
    applyCliRuntimeEnvSanitization(dotenvOptions.env ?? process.env);
    return dotenvResult;
  };
}