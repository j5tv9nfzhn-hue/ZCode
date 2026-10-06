import { parseArgs } from "node:util";

/**
 * 协议服务端的参数面。
 *
 * 交互式 CLI 的选项（--prompt / --target / --resume / --mode / --locale / 插件商店开关等）
 * 已随 CLI 产品移除，这里只保留协议子进程实际消费的开关。
 * 桌面 Host 与远程 stdio 资产都用同一份定义启动 `app-server --stdio --surface desktop`。
 */
export const parseProtocolServerArgs = (argv: string[]) =>
  parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      cwd: {
        type: "string",
      },
      surface: {
        type: "string",
      },
      "prepare-storage": {
        type: "boolean",
      },
      stdio: {
        type: "boolean",
      },
    },
    strict: true,
  });

/** 入口与命令路由复用同一参数定义，不能把 protocol 的开关值误当成命令名。 */
export function isProtocolServerInvocation(argv: string[]): boolean {
  try {
    const parsed = parseProtocolServerArgs(argv);
    return parsed.positionals[0] === "app-server" || parsed.positionals[0] === "agent-server";
  } catch {
    // 无效参数由 run 格式化；明确的协议命令仍保护 stdout。
    return argv[0] === "app-server" || argv[0] === "agent-server";
  }
}