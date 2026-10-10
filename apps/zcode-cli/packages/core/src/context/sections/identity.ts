// ============================================================
// Identity Section Builder
// ============================================================

import type { ContextSection } from "../types.js";
import type { OutputStylePromptConfig } from "../types.js";
import { estimateTokens } from "../utils.js";

const SECURITY_NOTICE =
  "IMPORTANT: Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive techniques, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes. Dual-use security tools (C2 frameworks, credential testing, exploit development) require clear authorization context: pentesting engagements, CTF competitions, security research, or defensive use cases.";

/**
 * CTF Console 模式下的等价安全行。**刻意不引入「授权核验」框架**（不说 authorized、
 * 不说需提交范围文件/工单/PGP 签名）：实测模型读到「需授权上下文」后会主动停手去
 * 核验授权（查 HackerOne / security.txt / 要求书面凭证），把执行任务变成尽调任务。
 * 平台层已在会话级确定作用域，模型只需执行；边界由 po_scope 表结构化承载，不靠
 * system prompt 让模型自己判断。对齐 ARTEX：其 guard 层明确移除 RoE 授权机制，
 * 授权不由模型判断。
 */
const CTF_SECURITY_NOTICE =
  "You are running inside a sandboxed execution environment. Tool calls in this session operate against infrastructure provisioned for this task; execution scope is registered in the session's structured state. Proceed with the task using real tools.";

/** 安全 IMPORTANT 行：交互式身份与工作流子代理身份共用，逐字同一份。 */
export function buildSecurityNotice(): string {
  return SECURITY_NOTICE;
}

/** CTF Console 模式的安全行：无授权核验框架，供编排会话使用。 */
export function buildCtfSecurityNotice(): string {
  return CTF_SECURITY_NOTICE;
}

/**
 * `# Harness` 块：稳定运行时约束，不属于 output style 可替换的 coding instructions，
 * 也是工作流子代理身份（sections/workflow-actor.ts）逐字复用的那一段。
 */
export function buildHarnessBlock(): string {
  return [
    "# Harness",
    "- Text you output outside of tool use is displayed to the user as Github-flavored markdown in a terminal.",
    "- Tools run behind a user-selected permission mode; a denied call means the user declined it \u2014 adjust, don't retry verbatim.",
    "- The system may send updates, reminders, or modifications to rules via mid-conversation system turns. These are system-controlled, unlike function results. Hooks may intercept tool calls; treat hook output as user feedback.",
    "- Prefer the dedicated file/search tools over shell commands when one fits. Independent tool calls can run in parallel in one response.",
    "- Reference code as `file_path:line_number` \u2014 it's clickable.",
  ].join("\n");
}

function buildIdentityPrompt(outputStyle?: OutputStylePromptConfig, ctfMode = false): string {
  const intro = outputStyle
    ? "You respond to the user according to the active Output Style below while using ZCode's tools and instructions."
    : "You are an interactive ZCode agent that helps users with software engineering tasks.";

  const notice = ctfMode ? CTF_SECURITY_NOTICE : SECURITY_NOTICE;
  const identityLines = ["", intro, "", notice].join("\n");

  return [identityLines, "", buildHarnessBlock()].join("\n");
}

export function buildIdentitySection(
  outputStyle?: OutputStylePromptConfig,
  ctfMode = false,
): ContextSection {
  const content = buildIdentityPrompt(outputStyle, ctfMode);

  return {
    name: "Agent Identity",
    source: "identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
