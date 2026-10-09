# Agent Bundle 启动成本（storage-prep 独立入口 + 字节码）

## 1. 问题

桌面冷启动时，`zcode.cjs` 这个单文件 bundle 会被 **最多 6 次**完整解析：

| 加载点 | 机制 | 次数 |
| --- | --- | --- |
| 存储准备 Worker | `new Worker(command.storagePreparationEntry)` `packages/desktop/src/host/storagePreparationProcesses.ts:130` | ≤3（每个预热工作区一个，串行） |
| agent 子进程 | `spawn(process.execPath, [entry, "app-server", …])` + `ELECTRON_RUN_AS_NODE=1` `packages/services/src/zcode-agent/zcodeAgentProcessManager.ts:453` | ≤3（`STARTUP_AGENT_WARMUP_LIMIT = 3`，`packages/desktop/src/main/startupWorkspace.ts:40`） |

出厂 bundle 经 `--desktop-agent` 构建（minify + keepNames，见 `cli/scripts/build.mjs:131,249`），
实测约 18.8 MB，单次 V8 编译约 0.78 s、端到端加载约 2.5 s。

**其中存储准备那一路是纯浪费**：它只做「开 SQLite、跑迁移、和 Host 握手」，
但为了拿到 `prepareProtocolStartupStorage`，必须加载承载 core / provider / MCP / ai-sdk 的整份 bundle。

## 2. 方案

给 `--prepare-storage` 一条**独立入口**，bundle 只含它的依赖闭包。

### 2.1 依赖闭包（已取证）

`bootstrap/src/zcode-protocol-entrypoint.ts:85-93` 在任何重活之前立即返回：

```ts
if (options.prepareStorageOnly) {
  const config = createConfig({ env: options.env });
  await prepareProtocolStartupStorage({ dbPath: getSessionDbPath(config, options.cwd), input, output });
  return;
}
```

logger / trace / StartupTimer / session store / provider registry / MCP 全部在其后（`:94` 起）。
实际闭包只有 4 个符号：

| 依赖 | 用途 |
| --- | --- |
| `@zcode/adapters/storage` | `SqliteSessionStore` |
| `@zcode/adapters/config` | `createConfig` |
| `@zcode/shared` | 4 个 schema / 错误分类函数 |
| `node:crypto`、`node:readline` | 哈希与握手 |

源码量约 2.0 MB，对照全量运行时约 17 MB。

### 2.2 产物

- `dist/zcode.cjs` —— 主 bundle，**行为不变**
- `dist/zcode.storage-prep.cjs` —— 新增，仅 `--prepare-storage`

## 3. 不变量

1. **主入口行为不变**：`main.ts` 与 `run.ts` 只做「把函数搬到共享模块再 import」，
   不改变分派逻辑。`zcode.cjs` 仍完整支持 `--prepare-storage`（其它调用方不受影响）。
2. **协议帧通道不被污染**：stdout 是严格 JSON 帧通道，storage-prep 进程必须先装
   stderr 边界，任何普通输出都会让对端 JSON 解析崩溃（与 `main.ts:28-31` 同因）。
3. **同源实现**：env / dotenv 准备逻辑只有一份实现在 `protocol-env.ts`，
   两个入口都调用它，禁止各自复制。
4. **可回退**：`storagePreparationEntry` 指向的新文件不存在时回退 `zcode.cjs`，
   最坏情况等于现状；`ZCODE_DESKTOP_AGENT_BYTECODE=0` 同理关闭字节码。
5. **V8 快照差异**：字节码**只用于 `ELECTRON_RUN_AS_NODE` 子进程**，
   不用于 Web Worker。两者 snapshot 不同，cachedData 可能被拒，
   而 `desktop-agent-bytecode-runtime.cjs:50-52` 在被拒时直接抛错，
   会让存储准备永久失败。`storagePreparationEntry` 因此固定走 JS。

## 4. 状态所有者

| 状态 | 所有者 |
| --- | --- |
| bundle 选择（JS / 字节码 / 回落） | `zcodeAgentProcessManager.ts` 同步 resolver |
| env / dotenv 准备 | `cli/src/protocol-env.ts` |
| 存储路径与握手时序 | `bootstrap/src/zcode-protocol/storage-startup.ts`（不变） |

## 5. 验收场景

| # | 场景 | 期望 |
| --- | --- | --- |
| A1 | Host 对新工作区发 `--prepare-storage` | 收到 `startup/storagePath` → 回 ack → 收到 `startup/storagePrepared` |
| A2 | ack 为 `reuse: true` | **不打开数据库**，直接发 `startup/storagePrepared`（现有语义，见 `storage-startup.ts:110-115`） |
| A3 | 数据库迁移失败 | 收到 `startup/storageState{phase:"failed"}`，进程退出码非 0 |
| A4 | 新入口文件缺失 | resolver 回退 `zcode.cjs`，A1 仍然成立 |
| A5 | 打包产物 | `resources/glm/` 同时含 `zcode.cjs`、`zcode.storage-prep.cjs`、`zcode.bytecode.cjs` |
| A6 | 与字节码共存 | `storagePreparationEntry` 始终是 `.cjs`，字节码只作用于 spawn 参数 |

## 6. 未覆盖 / 剩余风险

- **未在打包产物上实测**：本次改动无法在本机验证（无 Electron dist、无 `bundled-agents/`）。
  验收场景 A1–A6 需在有产物的机器上执行。
- **未处理**：TypeScript 编译器（10.2 MB，占 bundle 33%）仍在包内。
  它被 `dynamic-workflow` 的 38 处静态 import 拉入，而 dynamic-workflow 又被
  bootstrap / core / adapters 共 57 处静态引用（含 storage 闭包内的 `dwf-journal.ts`），
  惰性化需要跨包重构，不在本次范围。external 化无效——静态 import 仍会立即加载。