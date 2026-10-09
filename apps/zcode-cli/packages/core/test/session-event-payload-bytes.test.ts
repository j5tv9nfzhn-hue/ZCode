// 回归用例来自真实性能缺陷：session event append 摘要过去对每个流式事件
// （含每个 token delta、含携带整份 tool input 的 StreamingToolLedgerUpdated）
// 无条件跑 `JSON.stringify` + `Buffer.byteLength`，而结果只喂一条每 100 条
// 才发一次的 debug 日志。行为约束比数值本身重要：
//   1. 结果必须与真实 JSON 字节数同量级（否则 debug 日志失去诊断价值）；
//   2. 大载荷必须 O(1)/字符串（不再全量扫描与分配）；
//   3. 病态输入（超长数组、循环引用）必须被熔断，不能把热点搬家。
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateSessionEventPayloadBytes } from "../src/runtime/helpers/session-event-payload-bytes.js";

function exactJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8");
}

test("小 payload：估算值与真实 JSON 字节数同量级", () => {
  const payload = { delta: "hello", done: false, kind: "text", assistantMessageId: "msg_01" };
  const estimated = estimateSessionEventPayloadBytes(payload);
  const exact = exactJsonBytes(payload);
  assert.ok(estimated > 0, "非空 payload 不应估成 0");
  const ratio = estimated / exact;
  assert.ok(ratio > 0.5 && ratio < 2, `估算 ${estimated} 与真实 ${exact} 偏差过大`);
});

test("单字段大字符串（tool input 形态）：估算读到真实体量，不被截断成 0", () => {
  const content = "x".repeat(200_000);
  const payload = { filePath: "src/big.ts", content };
  const estimated = estimateSessionEventPayloadBytes(payload);
  assert.ok(
    estimated >= content.length,
    `估算 ${estimated} 必须覆盖 ${content.length} 的内容体量（历史实现会在这里分配 200KB 字符串）`,
  );
  const ratio = estimated / exactJsonBytes(payload);
  assert.ok(ratio > 0.9 && ratio < 1.1, `大载荷估算 ${estimated} 应贴近真实值`);
});

test("StreamingToolLedgerUpdated 形态：结构嵌套 + Date 不破坏估算", () => {
  const payload = {
    attemptId: "attempt_1",
    toolCallId: "call_1",
    toolName: "Write",
    status: "running",
    startedAt: new Date("2026-10-09T00:00:00.000Z"),
    input: { filePath: "a.ts", content: "y".repeat(50_000) },
  };
  const estimated = estimateSessionEventPayloadBytes(payload);
  const ratio = estimated / exactJsonBytes(payload);
  assert.ok(ratio > 0.9 && ratio < 1.1, `估算 ${estimated} 应贴近真实 ${exactJsonBytes(payload)}`);
});

test("熔断：超长数组只累加预算内节点，不退化成全量遍历", () => {
  const payload = { parts: Array.from({ length: 100_000 }, (_, index) => `part-${index}`) };
  const estimated = estimateSessionEventPayloadBytes(payload);
  assert.ok(estimated > 0);
  // 熔断后不可能覆盖全部 10 万个字符串（约 1.1MB），必须显著低于全量值。
  assert.ok(estimated < 20_000, `熔断失效：估算 ${estimated} 说明遍历了全部元素`);
});

test("熔断：循环引用返回部分和而不是抛错归零", () => {
  const payload: Record<string, unknown> = { kind: "loop" };
  payload.self = payload;
  const estimated = estimateSessionEventPayloadBytes(payload);
  assert.ok(estimated > 0, "循环引用不应像 JSON.stringify 那样抛错后被归零");
});

test("顶层标量 / 数组 / null 都能给出正量级，不抛错", () => {
  for (const value of [1, true, null, "text", [1, 2, 3], [{ kind: "a" }]]) {
    assert.ok(estimateSessionEventPayloadBytes(value) > 0);
  }
});

test("字段越多估算越大（单调性，保证摘要可用于定位膨胀来源）", () => {
  const small = estimateSessionEventPayloadBytes({ kind: "text" });
  const large = estimateSessionEventPayloadBytes({
    kind: "text",
    attemptId: "attempt_1",
    toolCallId: "call_1",
    toolName: "Write",
    readOnly: false,
    destructive: true,
  });
  assert.ok(large > small);
});