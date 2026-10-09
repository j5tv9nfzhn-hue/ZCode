// microcompact 关闭分支的性能短路（2026-10-09 修复）回归测试。
//
// 背景：microcompact 默认关闭（runtime/methods/microcompact.ts 的
// resolveLocalMicrocompactConfig 写死 `enabled === true` 才启用），但原实现是
// 「先做全量 provider 投影 + 逐块深拷贝，再判断 enabled」——于是默认配置下
// 每个 model step 白付两次全量深拷贝 + 一次全量 token 估算，换来 reason=disabled。
//
// 实测（960 条历史 / 1347 KB 消息体）：15.54 ms/step → 0.0002 ms/step。
import assert from "node:assert/strict";
import { test } from "node:test";
import type { RuntimeMessageEntry } from "../src/agent/message-history.js";
import { maybeLocalMicrocompactRuntimeEntries } from "../src/runtime/helpers/compact.js";
import { maybeLocalMicrocompactMessages } from "../src/compact/microcompact.js";

const DISABLED = { enabled: false as const, thresholdTokens: 100_000 };

function history(): RuntimeMessageEntry[] {
  return [
    { kind: "message", message: { role: "user", content: "对 test.example 做授权渗透测试" } },
    {
      kind: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "侦察中。" }],
        toolCalls: [{ id: "t1", name: "Bash", arguments: { command: "curl -s https://test.example" } }],
      },
    },
    {
      kind: "message",
      message: { role: "user", content: [{ type: "tool_result", toolCallId: "t1", content: "x".repeat(4000) }] },
    },
  ];
}

/**
 * 一个**无法被 provider 投影处理**的 attachment entry。
 *
 * renderProjectedEntryToModelMessage 对未知 source 会直接 throw
 * （provider-request-messages.ts:188-190），所以它是一根精确的探针：
 * 关闭态若真的跑了投影，这里就会抛；短路生效则安静返回。
 */
function malformedAttachmentEntry(): RuntimeMessageEntry {
  return {
    kind: "attachment",
    content: "probe",
    metadata: { source: "definitely-not-a-real-source" as never },
  };
}

test("关闭时不产出 payload，且 entries 原样返回（引用相等，不改写历史）", () => {
  const entries = history();
  const result = maybeLocalMicrocompactRuntimeEntries({ config: DISABLED, entries });

  assert.equal(result.decision.reason, "disabled");
  assert.equal(result.payload, undefined);
  assert.equal(result.entries, entries, "关闭时必须原样返回同一个数组引用");
});

test("关闭时不产出 estimatedTokenCount——证明确实没有做全量 token 估算", () => {
  const result = maybeLocalMicrocompactRuntimeEntries({ config: DISABLED, entries: history() });

  assert.equal(
    result.decision.estimatedTokenCount,
    undefined,
    "关闭时若仍给出 token 数，就说明克隆+估算还在跑，这次修复就白做了",
  );
});

test("关闭时跳过 provider 投影：畸形 attachment 不会抛异常", () => {
  const entries: RuntimeMessageEntry[] = [malformedAttachmentEntry()];

  // 若短路失效，这里会因未知 attachment source 抛错（provider-request-messages.ts:188）。
  const result = maybeLocalMicrocompactRuntimeEntries({ config: DISABLED, entries });

  assert.equal(result.decision.reason, "disabled");
  assert.equal(result.entries, entries);
});

test("开启态不被短路：仍产出 token 估算并走 trigger 判定", () => {
  const result = maybeLocalMicrocompactRuntimeEntries({
    config: { enabled: true, thresholdTokens: 100_000 },
    entries: history(),
  });

  assert.notEqual(result.decision.reason, "disabled");
  assert.equal(typeof result.decision.estimatedTokenCount, "number");
  assert.ok((result.decision.estimatedTokenCount ?? 0) > 0);
  // 阈值远高于实际用量，未达触发条件。
  assert.equal(result.decision.reason, "not_triggered");
});

test("开启态仍会对畸形 attachment 抛错（证明投影路径没被误伤）", () => {
  const entries: RuntimeMessageEntry[] = [malformedAttachmentEntry()];

  assert.throws(
    () => maybeLocalMicrocompactRuntimeEntries({ config: { enabled: true }, entries }),
    /not a system reminder source/,
  );
});

test("enabled 缺席时按启用处理（两处判据语义一致，未被改成 !== true）", () => {
  const result = maybeLocalMicrocompactRuntimeEntries({ config: {}, entries: history() });

  assert.notEqual(result.decision.reason, "disabled", "enabled 缺席应继续走 trigger 判定");
  assert.equal(typeof result.decision.estimatedTokenCount, "number");
});

test("直接调用 maybeLocalMicrocompactMessages 时短路同样生效", () => {
  const result = maybeLocalMicrocompactMessages({
    config: DISABLED,
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(result.decision.reason, "disabled");
  assert.equal(result.payload, undefined);
  assert.equal(result.decision.estimatedTokenCount, undefined);
});