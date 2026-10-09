// ============================================================
// logical deltas 帧的字节计量：精确路径的替代品（增量上界）与共用工具
// ============================================================
//
// 为什么住在这里而不是 publisher 里：这一组纯函数是一条**要被单独钉住的不变式**，
// publisher 是带订阅注册表、保留日志和投影的运行时外壳，在这里读它得先搭半个传输层。
// 和 conversation-workflow-run-deltas.ts 是同一条理由。
//
// ── 一、要修的是什么 ──
//
// `ingest` 对每条事件、每个订阅者调用一次 flush buffer 的 append。原先每次 append 都把
// 整个累积 buffer `JSON.stringify` 一遍再 `TextEncoder` 编码一遍，只为和 1 MiB 比大小。
// 流式正文每来一个 token 就是一条事件，于是「序列化整个累积 buffer」这条 O(buffer) 的
// 账在一整段流上被付了 n 次——O(n²)。冷恢复那段（v4 publisher 的 tryBatchHydration）
// 已经用同一个手法改过一次（wire-codec 的 estimate + 精确回退），这里是它的续篇。

import { Buffer } from "node:buffer";
import type { ConversationDelta } from "@zcode/shared/zcode-protocol-v4";

/**
 * 高频字节计量共用：TextEncoder 会为每次测量新建编码器并再分配一个完整 Uint8Array。
 * CLI 已固定运行在 Node，这里对同一 JSON 文本直接计算精确 UTF-8 字节数，不做近似估算。
 *
 * 与 TextEncoder 逐字节一致：`JSON.stringify` 自 ES2019 起输出良构 JSON（孤立代理被
 * 转义成 `\uXXXX`），所以两种 API 拿到的是同一串 UTF-16 文本，字节数相同。
 */
export function jsonUtf8ByteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
}

/**
 * 空 deltas 帧（`{"kind":"deltas","deltas":[]}`）的字节数，也是 flush buffer 帧字节
 * 上界的固定基底。空 buffer 的帧同样非空，所以它是上界的下界而不是 0——`maxBytes = 0`
 * 这类退化限额下的 overflow 判定正建立在这一项上。
 */
export const EMPTY_DELTAS_FRAME_BYTES = jsonUtf8ByteLength({ kind: "deltas", deltas: [] });

/** JSON 数组的元素分隔符 `,`：上界里按每个元素各摊一份（首个元素多算一字节，是上界）。 */
const DELTAS_FRAME_SEPARATOR_BYTES = 1;

/**
 * 帧字节上界占限额的比例，越过它才回退到对整帧的精确测量。
 *
 * 取 0.8 而不是 1.0：精确测量后记账基线会收紧到真实值，于是精确测量变成「上界每重新
 * 爬升 20% 限额才发生一次」的稀疏事件，而不是一旦逼近就逐事件重复整帧序列化。反过来，
 * 取 1.0 也不会削弱保证（越过即精确测量），只会让估算长期贴着限额、白付那份逐事件的
 * 整帧序列化——那正是本次要删掉的成本。
 */
export const DELTAS_FRAME_EXACT_MEASUREMENT_RATIO = 0.8;

// ── 二、增量上界为什么成立 ──
//
// 记 `bytes(X)` = `utf8JsonByteLength({kind:"deltas", deltas: X})`。不变式是
// `U ≥ bytes(buffer)`（U 是记账值，不小于真值）。一步 append 的依据是两条事实：
//
// 1. **coalesce 只减不增**：`bytes(coalesce(A ++ B)) ≤ bytes(A ++ B)`。每条规则要么
//    丢弃元素（规则 3 的 row.upserted 吞掉更早的 row.delta、规则 6 的
//    workflowRun.removed 吞掉同 run 的增量），要么把若干条并成一条而合并体不比两条之和
//    大——键级浅合并（state.updated 的 patch、workflowRun 的 header）取的是并集，重复键
//    只留一个、值取其一而非相加；`row.delta` 的 append 是字符串拼接，JSON 转义逐码元计费，
//    跨边界的代理对按整对计费只会比分开计更省；workflowRun 的 actors/nodes 是按键 upsert、
//    removed* 是去重并集。信封 `{op:…,runId:…}` 合并后只出现一次。
// 2. **数组拼接可加**：`bytes(A ++ B) = bytes(A) + Σ|json(b)| + |B|`（多出的 |B| 是元素间
//    的逗号分隔符）。
//
// 两式相加：`bytes(coalesce(A ++ B)) ≤ bytes(A) + Σ|json(b)| + |B|`，右边第二项就是
// {@link conversationDeltasBytesUpperBoundIncrement}。所以把 U 按它累加，不变式得证。

/**
 * 一批 delta 的字节上界**增量**：逐条序列化字节 + 每条一份数组分隔符。
 *
 * 代价只与这批新内容成正比，与 flush buffer 里已有的内容无关——这正是把每事件的
 * O(buffer) 整帧序列化降成 O(新内容) 的那一步。
 */
export function conversationDeltasBytesUpperBoundIncrement(
  deltas: readonly ConversationDelta[],
): number {
  let bytes = 0;
  for (const delta of deltas) {
    bytes += jsonUtf8ByteLength(delta) + DELTAS_FRAME_SEPARATOR_BYTES;
  }
  return bytes;
}

// ── 三、overflow 保证怎么被保住 ──
//
// 这条增量式只**替换「确认」不替换「裁决」**：
//
//   * 上界 U ≤ maxBytes × 0.8 时跳过精确测量。此时 `真实字节 ≤ U ≤ maxBytes`，超限**不可能**
//     发生，跳过的只是那一次确认。放行与「精确测一遍发现没超」是同一个结论。
//   * U 越过阈值时上界已不足以裁决，回退到整帧精确测量，用它比较 `> maxBytes`——与改动前
//     逐位一致；并把精确值回填为新的 U，使记账从紧基线重新积累，不长期漂在限额之上。
//
// 即：overflow 永远只由精确测量产出，估算从不单独触发降级。估算偏大只是让精确路径多跑
// 几次（每次都收敛回真值），估算偏小则由上面第二节的不变式根本不会发生。
// `maxBytes = 0` 时阈值也是 0、上界恒大于阈值，于是恒走精确路径，与改动前完全一致。