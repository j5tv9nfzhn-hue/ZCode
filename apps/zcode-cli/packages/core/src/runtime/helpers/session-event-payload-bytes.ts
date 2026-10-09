// ============================================================
// Session event 摘要日志的 payload 体量估算
// ============================================================

/**
 * 估算遍历预算。
 *
 * 这不是精度参数，是**熔断**：没有它，一个 10 万键的对象或自引用结构会让
 * 「为了省 CPU 加的估算」本身变成新的 CPU 热点。耗尽预算就返回部分和，
 * 对「这条流大概有多重」这个信号而言部分和完全够用。
 */
const SESSION_EVENT_PAYLOAD_BYTE_NODE_BUDGET = 512;

/** `{}` / `[]` 的定界符字节。 */
const JSON_CONTAINER_BRACE_BYTES = 2;
/** 键在 JSON 里的固定开销：一对外层引号 + 一个冒号。 */
const JSON_KEY_OVERHEAD_BYTES = 3;
/** 字符串值的一对外层引号。 */
const JSON_STRING_QUOTE_BYTES = 2;
/** number / boolean / null 的量级取值（真实长度随数值大小变化，不值得逐个精确算）。 */
const JSON_SCALAR_BYTES = 4;
/** `JSON.stringify(new Date())` 的固定字节数：ISO 串 24 字符 + 一对外层引号。 */
const JSON_SERIALIZED_DATE_BYTES = 26;

/**
 * 估算 session event payload 的 JSON 体量，替代整份 `JSON.stringify` + `Buffer.byteLength`。
 *
 * ## 背景（bug 原因）
 *
 * `runtime/methods/events.ts` 的 append 摘要对每个流式事件都**无条件**跑一次完整
 * 序列化——ModelStreaming 的每个 token delta、StreamingToolLedgerUpdated、
 * ToolCallProgress 一个不落——而这个字节数只喂一条每
 * `SESSION_EVENT_APPEND_SUMMARY_FLUSH_COUNT`（100）条才发一次的 debug 汇总日志。
 * StreamingToolLedgerUpdated 的 payload 带整份 tool input，一次大 Write/Edit 就是
 * 100KB+ 字符串：`JSON.stringify` 必须分配等量字符串，`Buffer.byteLength` 再完整扫一遍，
 * 两次全量遍历，而结果 99 次被丢弃。
 *
 * ## 做法
 *
 * 结构遍历求和，字符串直接取 `length`——V8 里 `String#length` 是 O(1) 的存储属性，
 * 不逐字符扫描。于是 100KB 的 tool input 退化成一次常量时间读取，剩下只遍历
 * 载荷的结构节点（几十个）。全程不构造中间字符串，零分配。
 *
 * 对 JSON 固定开销（引号、冒号、定界符、标量）也做了计入，所以结果与真实
 * `JSON.stringify` 字节数同量级、且对「小字段多」和「大字符串」两类载荷都偏差很小。
 *
 * ## 语义边界
 *
 * 返回的是**近似**值：多字节字符按 UTF-16 码元计（会偏小），逗号分隔符未逐个计入，
 * 超预算的部分不计入。它只喂 `event_store.appended.summary` 这条 debug 日志，
 * 不参与限流、裁剪、持久化或任何业务判断，因此近似可接受；真要按字节做阈值判断，
 * 必须换回精确测量。
 *
 * 循环引用不再像 `JSON.stringify` 那样抛错被上层归零，而是耗尽预算后返回部分和。
 */
export function estimateSessionEventPayloadBytes(value: unknown): number {
  const pending: unknown[] = [value];
  let bytes = 0;
  let remainingVisits = SESSION_EVENT_PAYLOAD_BYTE_NODE_BUDGET;
  while (pending.length > 0 && remainingVisits > 0) {
    remainingVisits -= 1;
    const current = pending.pop();
    if (typeof current === "string") {
      bytes += current.length + JSON_STRING_QUOTE_BYTES;
      continue;
    }
    if (current === null || typeof current !== "object") {
      bytes += JSON_SCALAR_BYTES;
      continue;
    }
    if (current instanceof Date) {
      bytes += JSON_SERIALIZED_DATE_BYTES;
      continue;
    }
    bytes += JSON_CONTAINER_BRACE_BYTES;
    if (Array.isArray(current)) {
      for (let index = 0; index < current.length && remainingVisits > 0; index += 1) {
        remainingVisits -= 1;
        pending.push(current[index]);
      }
      continue;
    }
    // for...in 而不是 Object.keys / Object.values：后者会先物化整个键数组，
    // 那样熔断就形同虚设（分配发生在熔断之前）。继承的可枚举属性对体量估算无影响。
    for (const key in current) {
      if (remainingVisits <= 0) break;
      remainingVisits -= 1;
      bytes += key.length + JSON_KEY_OVERHEAD_BYTES;
      pending.push((current as Record<string, unknown>)[key]);
    }
  }
  return bytes;
}