import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";

/**
 * 实时指标条（composer 下方速度/吞吐）的纯估算核心。
 *
 * 与 useConversationLiveMetrics.ts 拆开的原因：采样/估算逻辑必须能在 node:test
 * 里不带 React 环境直接断言（仓库单测入口是 tsx --test，无 DOM）。
 * 本模块不允许引入 react 或 "@/..." 别名——保持测试依赖为零。
 */

/**
 * 生成速度的滑动窗口。
 *
 * 取值口径参考 DeepSeek Harness 生态的 live-stats 类插件（TPS 按「最近一段时间的输出增量」
 * 估算，而不是「本次请求总输出 ÷ 全程耗时」）：后者在长回答里会被开头的首 token 延迟
 * 稀释，用户看到的数字远低于体感速度。
 */
export const TOKENS_PER_SECOND_WINDOW_MS = 5_000;

// chars → tokens 估算权重。CJK 约 1 字 ≈ 0.6 token（主流 BPE 分词把常用汉字切成
// 1-2 个 token），拉丁文约 4 chars/token。中文对话模型的实际输出（中文 + 代码 +
// markdown 混合）介于两者之间；该常量追求的是「量级正确」，不是精确值。
const CJK_TOKENS_PER_CHAR = 0.6;
const LATIN_CHARS_PER_TOKEN = 4;

/** 码点级 CJK/假名/谚文判定；不用 RegExp，避免每帧在热路径上重建匹配状态。 */
function isCjkCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) || // 日文假名
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) || // CJK 扩展 A
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK 统一表意文字
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // 谚文音节
    (codePoint >= 0xf900 && codePoint <= 0xfaff) // CJK 兼容表意文字
  );
}

/**
 * 估算一段文本的 token 数（CJK 加权）。导出供 node:test 直接断言。
 * 只用于速率估算，绝不可用于计费或上下文水位。
 */
export function estimateTokensInTextSegment(segment: string): number {
  if (segment.length === 0) return 0;
  let cjk = 0;
  for (const character of segment) {
    if (isCjkCodePoint(character.codePointAt(0) ?? 0)) cjk += 1;
  }
  return cjk * CJK_TOKENS_PER_CHAR + (segment.length - cjk) / LATIN_CHARS_PER_TOKEN;
}

/** 计入模型输出 token 的行文本；返回 null 表示该行不承载输出。 */
function resolveRowOutputText(row: ConversationRow): string | null {
  switch (row.kind) {
    case "assistantText":
      // 失败行的正文是半途产物，不计入（与「成功输出」的口径一致）。
      return row.state === "failed" ? null : row.text;
    case "reasoning":
      return row.text;
    case "toolCall":
      // 工具入参同样是模型输出：只数正文会让「连续调用大参数工具」的区间速率掉底。
      return row.inputText;
    default:
      return null;
  }
}

export interface OutputTokenLedger {
  /** 会话累计估算输出 token；TPS 采样的单调信号。 */
  totalTokens: number;
  /** rowId → 该行最后一次观测的文本长度与估算 token。 */
  rows: Map<number, { textLength: number; tokens: number }>;
}

export function createOutputTokenLedger(): OutputTokenLedger {
  return { totalTokens: 0, rows: new Map() };
}

/**
 * 把快照的最新行窗并入账本，返回会话累计估算输出 token。导出供 node:test 断言。
 *
 * 单调性保障（TPS 采样依赖总值不因窗口滑动而回落）：
 * - 行文本只增量追加（row.delta append），因此只对新增切片计价并累加，成本 O(新字符)；
 * - 行滑出尾部窗口时**不删除**其账本条目——被逐出的行不再增长，冻结历史留在总值里，
 *   之后的增量依然精确，且长会话滚动不会把总值抹掉；
 * - 行被整行重写（row.upserted / rewind / 切换会话后的 rowId 复用）表现为文本变短 →
 *   整行重估并调整总值。此时增量短暂为负，速率判定为无效（computeRateFromSamples 返回
 *   null），下一帧自然恢复；
 * - 同长度重写（长度不变、内容变化）无法从长度信号察觉，误差为一次性的一行，接受。
 */
export function applyRowsToOutputTokenLedger(
  ledger: OutputTokenLedger,
  rows: readonly ConversationRow[] | undefined,
): number {
  for (const row of rows ?? []) {
    const text = resolveRowOutputText(row);
    if (text === null) continue;
    const previous = ledger.rows.get(row.rowId);
    if (previous && text.length >= previous.textLength) {
      if (text.length === previous.textLength) continue;
      const appendedTokens = estimateTokensInTextSegment(text.slice(previous.textLength));
      previous.tokens += appendedTokens;
      // 必须同步游标：漏了这行，下一帧会把同一段 text.slice(old..new) 再次计价，
      // 流式期间每帧都重复计费 → TPS 系统性虚高（CI 单测第三次应用时抓到，actual 3≠2）。
      previous.textLength = text.length;
      ledger.totalTokens += appendedTokens;
    } else {
      const tokens = estimateTokensInTextSegment(text);
      ledger.totalTokens += tokens - (previous?.tokens ?? 0);
      ledger.rows.set(row.rowId, { textLength: text.length, tokens });
    }
  }
  return ledger.totalTokens;
}

/** 从采样窗口计算 token/s；点数不足、时间未推进或增量为负（rewind/切会话）时为 null。 */
export function computeRateFromSamples(
  samples: readonly { at: number; tokens: number }[],
): number | null {
  if (samples.length < 2) return null;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const elapsedMs = last.at - first.at;
  if (elapsedMs <= 0) return null;
  const delta = last.tokens - first.tokens;
  // 负增量只可能来自会话切换/回退，视为无有效速率。
  if (delta <= 0) return null;
  return (delta * 1000) / elapsedMs;
}
