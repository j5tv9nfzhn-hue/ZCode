// judge 输出的严格解析——对齐 ARTEX intercept/prompt.go:144-205 的 ParseVerdict。
//
// 设计纪律（逐条对齐 ARTEX）：
//   · 只做**确定性解包**（剥掉 \`\`\`json 栅栏），不做"修复"；
//   · 必须是完整 JSON 对象，恰好两个字符串字段 {decision, comment}；
//   · decision ∈ {allow, ask, deny}；
//   · comment 必须以「实际操作：」开头，三段式齐全；
//   · 任何不完整 / 歧义 / 散文 → 返回空 verdict → 调用方走 failAction（默认 allow）。
//
// **绝不从散文里提取关键词**——那等于替模型编造裁决。

import type { JudgeVerdict } from "./types.js";

/**
 * 剥掉 markdown 代码栅栏。这是确定性解包，不是修复：
 * 内层仍走严格解析，截断/歧义/散文依旧解析失败。
 *
 * 之所以需要它：failAction 默认是 allow——模型只是把 JSON 包在 \`\`\`json 里
 * 就变成"静默放行"，会把一次 DENY 变成 ALLOW。
 */
export function stripCodeFence(text: string): string {
  let t = text.trim();
  if (t.length <= 6 || !t.startsWith("\`\`\`") || !t.endsWith("\`\`\`")) {
    return t;
  }
  t = t.slice(3, t.length - 3).trim();
  if (!t.startsWith("{")) {
    // 去掉开栅栏的语言标签行（\`\`\`json）
    const newlineIndex = t.indexOf("\n");
    if (newlineIndex >= 0) {
      t = t.slice(newlineIndex + 1).trim();
    }
  }
  return t;
}

/**
 * 严格解析 judge 输出。返回空 verdict（action: ""）表示解析失败。
 */
export function parseVerdict(text: string): JudgeVerdict {
  const stripped = stripCodeFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { action: "", reason: "" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { action: "", reason: "" };
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  // 恰好两个字段
  if (keys.length !== 2 || !keys.includes("decision") || !keys.includes("comment")) {
    return { action: "", reason: "" };
  }
  const decision = record.decision;
  const comment = record.comment;
  if (typeof decision !== "string" || typeof comment !== "string") {
    return { action: "", reason: "" };
  }
  if (decision !== "allow" && decision !== "ask" && decision !== "deny") {
    return { action: "", reason: "" };
  }
  // comment 长度上限 2400（对齐 ARTEX：过长视为异常，不是合法裁决）
  if (comment.length > 2400) {
    return { action: "", reason: "" };
  }
  // 三段式校验：必须以「实际操作：」开头，含「；成功后的后果：」与「；命中规则：」
  const trimmed = comment.trim();
  if (!trimmed.startsWith("实际操作：")) {
    return { action: "", reason: "" };
  }
  const afterOp = trimmed.slice("实际操作：".length);
  const consequenceSplit = afterOp.indexOf("；成功后的后果：");
  if (consequenceSplit < 0) {
    return { action: "", reason: "" };
  }
  const operation = afterOp.slice(0, consequenceSplit).trim();
  if (operation.length === 0) {
    return { action: "", reason: "" };
  }
  const rest = afterOp.slice(consequenceSplit + "；成功后的后果：".length);
  const ruleSplit = rest.indexOf("；命中规则：");
  if (ruleSplit < 0) {
    return { action: "", reason: "" };
  }
  const consequence = rest.slice(0, ruleSplit).trim();
  const rule = rest.slice(ruleSplit + "；命中规则：".length).trim();
  if (consequence.length === 0 || rule.length === 0) {
    return { action: "", reason: "" };
  }
  return { action: decision, reason: trimmed };
}
