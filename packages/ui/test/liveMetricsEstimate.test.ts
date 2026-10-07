import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import {
  applyRowsToOutputTokenLedger,
  computeRateFromSamples,
  createOutputTokenLedger,
  estimateTokensInTextSegment,
} from "../src/v4/composer/liveMetricsEstimate.js";

// 测试替身只需覆盖估算逻辑读到的字段；完整 schema 校验是 CLI 投影的职责，不在这里重复。
function assistantTextRow(rowId: number, text: string, state = "streaming"): ConversationRow {
  return { kind: "assistantText", rowId, text, state } as unknown as ConversationRow;
}

function reasoningRow(rowId: number, text: string): ConversationRow {
  return { kind: "reasoning", rowId, text, state: "streaming" } as unknown as ConversationRow;
}

function toolCallRow(rowId: number, inputText: string): ConversationRow {
  return { kind: "toolCall", rowId, inputText, status: "running" } as unknown as ConversationRow;
}

/** CJK 权重是 0.6，浮点累加路径不同末位可能不同；只断言量级。 */
function closeTo(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
}

test("token 估算按 CJK 加权：拉丁 4 chars/token，CJK 0.6 token/字", () => {
  assert.equal(estimateTokensInTextSegment(""), 0);
  // 拉丁路径是 k/4，二进制可精确表示，用严格相等。
  assert.equal(estimateTokensInTextSegment("abcdefghij"), 2.5);
  closeTo(estimateTokensInTextSegment("你好世界你好世界你好"), 6);
  closeTo(estimateTokensInTextSegment("你好abcd"), 0.6 * 2 + 1);
  // 代理对（emoji）按码点去重计数：1 个码点占 2 个 code unit → 0.5 token，不被拆成 1。
  assert.equal(estimateTokensInTextSegment("😀"), 0.5);
});

test("TPS 根因回归：cumulative token 不动、流式文本增长时，账本必须持续出增量", () => {
  // 修复前的死局：onModelComplete 之前 usage.cumulative.outputTokens 恒为 0，
  // 采样点凑不齐两个，UI 恒显「—」。修复后信号源是行文本增长，每帧 row.delta 都进账本。
  const ledger = createOutputTokenLedger();
  // 拉丁文本 k/4 计价精确，用严格相等锁定增量式累加的正确性。
  assert.equal(applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "aaaa")]), 1);
  assert.equal(applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "aaaaaaaa")]), 2);
  // 同一帧重复应用（StrictMode 双调用/多订阅者）不得重复计价。
  assert.equal(applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "aaaaaaaa")]), 2);
  // 只对新增切片计价：追加一段中文只补中文部分。
  const before = 2;
  const after = applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "aaaaaaaa你好")]);
  closeTo(after, before + 1.2);
});

test("reasoning 与 toolCall 入参都计入输出（连续工具调用的空窗不掉速）", () => {
  const ledger = createOutputTokenLedger();
  applyRowsToOutputTokenLedger(ledger, [reasoningRow(1, "aaaa")]);
  const after = applyRowsToOutputTokenLedger(ledger, [
    reasoningRow(1, "aaaa"),
    toolCallRow(2, "bbbb"),
  ]);
  assert.equal(after, 2);
});

test("failed 正文不计入输出", () => {
  const ledger = createOutputTokenLedger();
  applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "abcdefgh", "failed")]);
  assert.equal(ledger.totalTokens, 0);
});

test("行滑出尾部窗口不回退总值（单调性是 TPS 采样的前提）", () => {
  const ledger = createOutputTokenLedger();
  applyRowsToOutputTokenLedger(ledger, [
    assistantTextRow(1, "aaaaaaaa"),
    assistantTextRow(2, "bbbbbbbb"),
  ]);
  const full = ledger.totalTokens;
  // 窗口只剩最后一行：行 1 被逐出窗口，历史冻结，总值不得回落。
  assert.equal(applyRowsToOutputTokenLedger(ledger, [assistantTextRow(2, "bbbbbbbb")]), full);
  // 窗口内新输出照常累加。
  assert.equal(
    applyRowsToOutputTokenLedger(ledger, [assistantTextRow(2, "bbbbbbbbcccccccc")]),
    full + 2,
  );
});

test("rewind/切换会话导致文本变短时整行重估，负增量被速率层拒绝", () => {
  const ledger = createOutputTokenLedger();
  applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "aaaaaaaa")]);
  const before = ledger.totalTokens;
  // rowId 复用但内容换短（rewind 或新会话首行）：总值下调到新行实价，不产生假增长。
  applyRowsToOutputTokenLedger(ledger, [assistantTextRow(1, "bbbb")]);
  assert.equal(ledger.totalTokens, 1);
  assert.equal(
    computeRateFromSamples([
      { at: 0, tokens: before },
      { at: 1000, tokens: 1 },
    ]),
    null,
  );
});

test("速率计算：两点窗口 2 秒 10 token → 5 token/s；退化输入返回 null", () => {
  assert.equal(
    computeRateFromSamples([
      { at: 0, tokens: 10 },
      { at: 2000, tokens: 20 },
    ]),
    5,
  );
  assert.equal(computeRateFromSamples([]), null);
  assert.equal(computeRateFromSamples([{ at: 0, tokens: 10 }]), null);
  // 时间未推进 / 零增量 / 负增量都不能出数。
  assert.equal(
    computeRateFromSamples([
      { at: 5, tokens: 1 },
      { at: 5, tokens: 9 },
    ]),
    null,
  );
  assert.equal(
    computeRateFromSamples([
      { at: 0, tokens: 5 },
      { at: 1000, tokens: 5 },
    ]),
    null,
  );
  assert.equal(
    computeRateFromSamples([
      { at: 0, tokens: 9 },
      { at: 1000, tokens: 5 },
    ]),
    null,
  );
});

test("undefined/空 rows（草稿会话尚无快照）安全返回 0", () => {
  const ledger = createOutputTokenLedger();
  assert.equal(applyRowsToOutputTokenLedger(ledger, undefined), 0);
  assert.equal(applyRowsToOutputTokenLedger(ledger, []), 0);
});
