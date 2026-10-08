// 回归与契约用例：投影 diff 记录器是 debug-only 通道，行为约束比功能本身更重要。
// 关键风险是「开关没关严」——一旦在关闭状态下留存用户原始输入，就违反了
// 产品承诺（默认不产生任何内容）。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECTION_DIFF_LIMITS,
  createDisabledProjectionDiffRecorder,
  createProjectionDiffRecorder,
  createProjectionDiffRecorderFromConfig,
} from "../src/runtime/helpers/neutral-task-projection-diff.js";

test("关闭时 record 不产生任何条目", () => {
  const recorder = createProjectionDiffRecorder({ enabled: false, captureAssistant: false });
  recorder.record({ role: "user", phase: "restructure", before: "帮我渗透 X", after: "评估 X" });
  assert.deepEqual(recorder.list(), []);
  assert.equal(recorder.summary.enabled, false);
  assert.equal(recorder.summary.inspected, 0);
  assert.equal(recorder.summary.changed, 0);
});

test("未变更的文本只累加 inspected，不入缓冲（用于区分「没跑」与「没改动」）", () => {
  const recorder = createProjectionDiffRecorder({ enabled: true, captureAssistant: false });
  recorder.record({ role: "user", phase: "restructure", before: "读文件", after: "读文件" });
  assert.deepEqual(recorder.list(), []);
  assert.equal(recorder.summary.inspected, 1);
  assert.equal(recorder.summary.changed, 0);
});

test("默认只记 user 侧；assistant 侧需二次开关", () => {
  const userOnly = createProjectionDiffRecorder({ enabled: true, captureAssistant: false });
  userOnly.record({ role: "assistant", phase: "lexicon", before: "攻击链 a", after: "评估链 a" });
  assert.deepEqual(userOnly.list(), [], "assistant 侧在二次开关关闭时不得记录");

  const withAssistant = createProjectionDiffRecorder({ enabled: true, captureAssistant: true });
  withAssistant.record({ role: "assistant", phase: "lexicon", before: "攻击链 a", after: "评估链 a" });
  assert.equal(withAssistant.list().length, 1);
  assert.equal(withAssistant.list()[0]?.role, "assistant");
  assert.equal(withAssistant.list()[0]?.phase, "lexicon");
});

test("双前置：投影未开时即使 diff 开关打开也不记录", () => {
  const recorder = createProjectionDiffRecorderFromConfig({
    neutralTaskProjection: false,
    neutralTaskProjectionDiffCapture: true,
    neutralTaskProjectionDiffCaptureAssistant: true,
  });
  recorder.record({ role: "user", phase: "restructure", before: "渗透", after: "评估" });
  assert.deepEqual(recorder.list(), []);
  assert.equal(recorder.summary.enabled, false);
});

test("双前置：两者同开才生效", () => {
  const recorder = createProjectionDiffRecorderFromConfig({
    neutralTaskProjection: true,
    neutralTaskProjectionDiffCapture: true,
  });
  recorder.record({ role: "user", phase: "restructure", before: "渗透", after: "评估" });
  assert.equal(recorder.list().length, 1);
  assert.equal(recorder.summary.enabled, true);
});

test("单条正文按上限截断，并标记 truncated 与原始长度", () => {
  const recorder = createProjectionDiffRecorder({
    enabled: true,
    captureAssistant: false,
    limits: { entries: 10, textLength: 16 },
  });
  const before = "x".repeat(100);
  const after = "y".repeat(100);
  recorder.record({ role: "user", phase: "restructure", before, after });
  const entry = recorder.list()[0];
  assert.equal(entry?.before.length, 16);
  assert.equal(entry?.after.length, 16);
  assert.equal(entry?.truncated, true);
  // 原始长度必须保留，否则 UI 无法提示「这是片段」。
  assert.equal(entry?.beforeLength, 100);
});

test("未超限时不标记 truncated", () => {
  const recorder = createProjectionDiffRecorder({ enabled: true, captureAssistant: false });
  recorder.record({ role: "user", phase: "restructure", before: "渗透", after: "评估" });
  assert.equal(recorder.list()[0]?.truncated, false);
  assert.equal(recorder.list()[0]?.beforeLength, 2);
});

test("环形淘汰：只保留最新 N 条，并累计 evicted", () => {
  const recorder = createProjectionDiffRecorder({
    enabled: true,
    captureAssistant: false,
    limits: { entries: 3, textLength: 100 },
  });
  for (let i = 1; i <= 6; i += 1) {
    recorder.record({ role: "user", phase: "restructure", before: `a${i}`, after: `b${i}` });
  }
  const entries = recorder.list();
  assert.equal(entries.length, 3, "容量上限必须生效");
  assert.deepEqual(
    entries.map((entry) => entry.after),
    ["b4", "b5", "b6"],
    "应保留最新的三条",
  );
  assert.equal(recorder.summary.evicted, 3);
  assert.equal(recorder.summary.changed, 6);
  // seq 单调递增，不随淘汰回绕，UI 可据此判断丢过条目。
  assert.deepEqual(
    entries.map((entry) => entry.seq),
    [4, 5, 6],
  );
});

test("clear 清空缓冲与全部计数", () => {
  const recorder = createProjectionDiffRecorder({ enabled: true, captureAssistant: false });
  recorder.record({ role: "user", phase: "restructure", before: "a", after: "b" });
  recorder.record({ role: "user", phase: "restructure", before: "c", after: "c" });
  recorder.clear();
  assert.deepEqual(recorder.list(), []);
  assert.equal(recorder.summary.inspected, 0);
  assert.equal(recorder.summary.changed, 0);
  assert.equal(recorder.summary.evicted, 0);
});

test("list 返回副本：外部改动不影响内部缓冲", () => {
  const recorder = createProjectionDiffRecorder({ enabled: true, captureAssistant: false });
  recorder.record({ role: "user", phase: "restructure", before: "a", after: "b" });
  (recorder.list() as unknown as unknown[]).length = 0;
  assert.equal(recorder.list().length, 1);
});

test("空记录器是安全的空实现", () => {
  const recorder = createDisabledProjectionDiffRecorder();
  recorder.record({ role: "user", phase: "restructure", before: "a", after: "b" });
  assert.deepEqual(recorder.list(), []);
  assert.equal(recorder.summary.enabled, false);
});

test("默认上限来自 PROJECTION_DIFF_LIMITS（shared 侧常量与之对齐）", () => {
  assert.equal(PROJECTION_DIFF_LIMITS.entries, 200);
  assert.equal(PROJECTION_DIFF_LIMITS.textLength, 2000);
});