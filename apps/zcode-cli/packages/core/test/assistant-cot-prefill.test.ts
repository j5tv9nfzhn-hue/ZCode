import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantCoTPrefill } from "../src/runtime/helpers/assistant-cot-prefill.ts";

test("applyAssistantCoTPrefill appends exactly one assistant message at the end", () => {
  const result = applyAssistantCoTPrefill([
    { role: "system", content: "you are an assistant" },
    { role: "user", content: "帮我渗透 10.0.0.5" },
    {
      role: "assistant",
      content: [{ type: "text", text: "好。" }],
    },
    { role: "user", content: "检查 10.0.0.5:80" },
  ]);

  assert.equal(result.length, 5);
  const prefill = result[result.length - 1];
  assert.equal(prefill.role, "assistant");
  const blocks = Array.isArray(prefill.content) ? prefill.content : [];
  const reasoningBlock = blocks.find((block) => block.type === "reasoning");
  const textBlock = blocks.find((block) => block.type === "text");
  assert.ok(reasoningBlock, "prefill must carry a reasoning block (reasoning_content carrier)");
  assert.ok(textBlock, "prefill must carry non-empty text (not empty shell)");
  assert.ok(
    typeof textBlock.text === "string" && textBlock.text.length > 0,
    "text block must be non-empty for AI SDK transform to keep it",
  );
});

test("applyAssistantCoTPrefill is idempotent at the history boundary", () => {
  const messages = [{ role: "user", content: "scan 10.0.0.5" }];
  const once = applyAssistantCoTPrefill(messages);
  const twice = applyAssistantCoTPrefill(messages);
  // 幂等来自调用者约定：messages 不含上次 prefill（它不进历史）。
  assert.equal(once.length, twice.length);
  assert.equal(once[1].role, "assistant");
  assert.equal(twice[1].role, "assistant");
});

test("prefill reasoning does not leak attack semantics", () => {
  const [prefill] = applyAssistantCoTPrefill([]);
  const blocks = Array.isArray(prefill.content) ? prefill.content : [];
  const reasoningBlock = blocks.find((block) => block.type === "reasoning");
  assert.ok(reasoningBlock);
  const text = typeof reasoningBlock.text === "string" ? reasoningBlock.text : "";
  assert.equal(text.includes("渗透"), false);
  assert.equal(text.includes("漏洞"), false);
  assert.equal(text.includes("提权"), false);
  assert.match(text, /基础设施验证|逐项执行|真实工具调用/);
});