import { createConfig } from "@zcode/adapters/config";
import { getSessionDbPath } from "./app/session-store.js";
import { prepareProtocolStartupStorage } from "./zcode-protocol/storage-startup.js";
import type { RunZCodeProtocolAgentOptions } from "./app/types.js";

/**
 * `--prepare-storage` 的**唯一**实现。
 *
 * 这个子路径存在的理由是体积，不是代码组织：Host 每次启动都会为每个预热工作区
 * fork 一个 Worker 来跑存储准备（`packages/desktop/src/host/storagePreparationProcesses.ts:130`），
 * 而该 Worker 的入口过去是完整的 zcode.cjs。为了开 SQLite、跑迁移、和 Host 握手，
 * 一次冷启动最多要白白解析 3 份承载 core / provider / MCP / ai-sdk 的整包。
 *
 * 走子路径导出而不是根 barrel，是因为 `@zcode/bootstrap` 的 `.` 会把
 * create-app 与全部 workflow 驱动重新拉进来，等于什么都没省掉。
 *
 * 实现与 zcode-protocol-entrypoint.ts 的 prepareStorageOnly 分支同源（见那里的调用点），
 * 两处不得各写一份。
 */
export async function runProtocolStoragePreparation(options: {
  cwd: RunZCodeProtocolAgentOptions["cwd"];
  env: RunZCodeProtocolAgentOptions["env"];
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}): Promise<void> {
  const config = createConfig({ env: options.env });
  await prepareProtocolStartupStorage({
    dbPath: getSessionDbPath(config, options.cwd),
    input: options.input,
    output: options.output,
  });
}