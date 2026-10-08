/**
 * 中性任务投影（message 级）。
 *
 * 文本层（词表、输入侧重构、工具名映射）住在 `@zcode/shared` 的
 * `neutral-task-projection.ts`：UI 的 CTF Console 预览面板与 core 共用同一份
 * 代码，保证「预览即真实」。本文件只保留需要 contracts 类型的 message 级
 * 投影，并 re-export 文本层函数，保持既有 import 面不变。
 *
 * 不变量（改动前务必读完）：
 * 1. 投影只在「请求投影层」生效（runModelTextRequest 组装 modelRequest 的
 *    那一刻）。历史里存的、UI 里显示的、落盘的都是原文。
 * 2. **不改 tool-call input 与 tool-result 正文**。那些是可执行载荷与真实
 *    观测：改写会让模型复述不存在的命令、把「已验证」说成「未验证」，
 *    直接破坏执行正确性。单条原始信号的成本，低于制造假历史的代价。
 * 3. 工具名投影必须双向：出站改写 provider 可见名，入站在
 *    normalizeModelToolCallsForRuntime 之前还原为注册表规范名，否则
 *    executor 的 registry.get(name) 会 miss。
 * 4. 无 IO、无状态、可单测；未命中任何规则时返回原字符串，保证
 *    provider 缓存锚点不因无意义改写而漂移。
 */

import {
  normalizeTurnInputForNeutralTaskMode,
  neutralizeTextForNeutralTaskProjection,
  projectToolNameForNeutralTaskProjection,
  restoreToolCallNameForNeutralTaskProjection,
} from "@zcode/shared";
import type { ModelInputMessage, ModelMessageContentBlock, ModelToolContract } from "../deps.js";

/**
 * 判定一条 role=user 消息是否为「合成消息」而非用户真实输入。
 *
 * 为什么必须区分（2026-10-08 实测缺陷）：compact 之后 runtime 会注入一条
 * `role: "user"` 的合成消息（metadata `legacy_synthetic`），内容是压缩摘要。
 * 摘要模板要求「List ALL user messages」，因此用户原话（如「帮我渗透 X」）
 * 会被逐字写进摘要。若对这类消息也做输入侧重构，摘要中的技术细节会被整段
 * 替换成任务书模板，上下文在压缩点被摧毁——这正是「压缩后出现混乱」的成因。
 *
 * 合成消息的两种可判定形态：
 * 1. system-reminder 包装（`provider-request-messages.ts` 的 attachment 渲染）；
 * 2. compact 续跑消息（以固定的 continuation 前导开头，见 compact/prompt.ts）。
 *
 * 判定失败时按「合成」处理：宁可少重构一次（措辞层面仍过词表层中和），
 * 也不要把整段摘要改写成任务书。
 */
const SYNTHETIC_USER_MARKERS: readonly RegExp[] = [
  /<\/?system-reminder\b/i,
  /^\s*This session is being continued from a previous conversation/i,
];

export function isSyntheticUserMessageText(text: string): boolean {
  return SYNTHETIC_USER_MARKERS.some((pattern) => pattern.test(text));
}

export {
  normalizeTurnInputForNeutralTaskMode,
  neutralizeTextForNeutralTaskProjection,
  projectToolNameForNeutralTaskProjection,
  restoreToolCallNameForNeutralTaskProjection,
};
export type { NormalizedTurnInput } from "@zcode/shared";
import type {
  ProjectionDiffPhase,
  ProjectionDiffRole,
} from "./neutral-task-projection-diff.js";

function projectContentBlockForNeutralTaskProjection(
  block: ModelMessageContentBlock,
): ModelMessageContentBlock {
  switch (block.type) {
    case "text":
      return { ...block, text: neutralizeTextForNeutralTaskProjection(block.text) };
    case "reasoning":
      // reasoning 也是出站内容：provider 会重放思维链，同样要中性化。
      return { ...block, text: neutralizeTextForNeutralTaskProjection(block.text) };
    // 其余块（image/video/file/resource_link）保持原样：要么是二进制，
    // 要么是文件正文（见不变量 2）。
    default:
      return block;
  }
}

/**
 * 叙事层中性化：**真实** user 消息走执行姿态注入（原文保留 + 注入块）；
 * 其余一律只过词表层。
 * - 真实 user 输入不再做语义删除（§1.8 / §1.9）：删掉「渗透 / 漏洞 / 提权」等于
 *   删掉攻击行为，实测模型因此整体退化为公开面功能核查。
 * - 合成 user 消息（system-reminder 包装 / compact 续跑摘要）只过词表层：它们的正文
 *   是技术细节，注入任务书会摧毁上下文（见 isSyntheticUserMessageText）。
 * - system / assistant 保持词表层行为：provider 侧的输入守卫通常扫整段会话，这里
 *   保留中和以降低后续轮次触发概率。
 */
function projectNarrativeContentForNeutralTaskProjection(
  message: ModelInputMessage,
  targetAllowlist: readonly string[],
): ModelInputMessage["content"] {
  const projectUserText = (text: string): string =>
    isSyntheticUserMessageText(text)
      ? neutralizeTextForNeutralTaskProjection(text)
      : normalizeTurnInputForNeutralTaskMode(text, { targetAllowlist }).text;
  const content = message.content;
  if (typeof content === "string") {
    return message.role === "user" ? projectUserText(content) : neutralizeTextForNeutralTaskProjection(content);
  }
  // 文本块形态的 user 输入（带附件的多块消息）同样走同一判定；
  // 非 text 块由内容投影逐块处理。
  return content.map((block) => {
    if (block.type === "text") {
      const text = message.role === "user" ? projectUserText(block.text) : neutralizeTextForNeutralTaskProjection(block.text);
      return { ...block, text };
    }
    return projectContentBlockForNeutralTaskProjection(block);
  });
}

function projectMessageForNeutralTaskProjection(
  message: ModelInputMessage,
  targetAllowlist: readonly string[],
  onDiff?: ProjectionDiffObserver,
): ModelInputMessage {
  // 不变量 2 的机器可判定分支：tool-result 的正文是真实观测，不改写；
  // 叙事层（system / user / assistant 文本）才做中性化。
  const isToolResult = message.role === "tool" || typeof message.toolCallId === "string";
  const projectedContent = isToolResult
    ? message.content
    : projectNarrativeContentForNeutralTaskProjection(message, targetAllowlist);
  // debug-only diff：只比较叙事文本，不看 tool-call input / tool-result 正文
  // （那两类按不变量 2 不改写，比较必然相等，纯属浪费）。
  const content = reportNarrativeProjectionDiff(message, projectedContent, onDiff);
  // toolCalls：只改 name，不动 input（不变量 2）。tool-result 的 toolName 与
  // tools 数组、assistant 回放必须一致，否则 provider 会拒绝 tool_use/tool_result
  // 配对。
  const toolCalls = message.toolCalls?.map((toolCall) => ({
    ...toolCall,
    name: projectToolNameForNeutralTaskProjection(toolCall.name),
  }));
  const toolName = message.toolName
    ? projectToolNameForNeutralTaskProjection(message.toolName)
    : undefined;
  return { ...message, content, ...(toolCalls ? { toolCalls } : {}), ...(toolName ? { toolName } : {}) };
}

function projectToolContractForNeutralTaskProjection(tool: ModelToolContract): ModelToolContract {
  return {
    ...tool,
    name: projectToolNameForNeutralTaskProjection(tool.name),
    ...(tool.description
      ? { description: neutralizeTextForNeutralTaskProjection(tool.description) }
      : {}),
    ...(typeof tool.capability === "string"
      ? { capability: neutralizeTextForNeutralTaskProjection(tool.capability) }
      : {}),
  };
}

export interface NeutralTaskProjectedModelRequest {
  messages: ModelInputMessage[];
  tools: ModelToolContract[];
}

/**
 * debug-only 投影 diff 观察口。由 runModelTextRequest 注入记录器；未开启时
 * 传 undefined，本模块不持有任何运行时状态（保持投影函数可单测）。
 */
export type ProjectionDiffObserver = (input: {
  readonly role: ProjectionDiffRole;
  readonly phase: ProjectionDiffPhase;
  readonly before: string;
  readonly after: string;
}) => void;

/** 取出消息里的全部叙事文本（text 块；字符串形态整体算一块）。 */
function readNarrativeTexts(content: ModelInputMessage["content"]): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text);
}

/** 比较投影前后的叙事文本并上报；返回投影后的 content 原样。 */
function reportNarrativeProjectionDiff(
  message: ModelInputMessage,
  projectedContent: ModelInputMessage["content"],
  onDiff: ProjectionDiffObserver | undefined,
): ModelInputMessage["content"] {
  if (!onDiff) return projectedContent;
  // system 不进 diff：系统提示词是产品自有文本，改写它不是用户需要观察的行为，
  // 且体积最大。user 真实输入才是「句式重构是否生效」的判据。
  const role = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
  if (!role) return projectedContent;
  const phase: ProjectionDiffPhase = role === "user" ? "restructure" : "lexicon";
  const before = readNarrativeTexts(message.content);
  const after = readNarrativeTexts(projectedContent);
  const beforeJoined = before.join("\n");
  const afterJoined = after.join("\n");
  onDiff({ role, phase, before: beforeJoined, after: afterJoined });
  return projectedContent;
}

/**
 * provider 请求投影：真实 user 输入注入执行姿态（原文保留），其余叙事文本与工具定义
 * 过词表层，工具名双向改写。
 * 只在 AgentRuntimeConfig.neutralTaskProjection 开启时由 runModelTextRequest
 * 调用；返回的是副本，canonical 历史不受影响。
 */
export function projectModelRequestForNeutralTaskProjection(input: {
  messages: readonly ModelInputMessage[];
  tools: readonly ModelToolContract[];
  /**
   * `neutralTaskTargetAllowlist`：命中时在 user 输入前注入一句作用域事实。
   * 缺席即空表——不声明任何授权，也不因此删用户词汇（见 shared/neutral-task-scope）。
   */
  targetAllowlist?: readonly string[];
  /** debug-only：观测「原文 → 投影后」配对。不参与任何返回值。 */
  onDiff?: ProjectionDiffObserver;
}): NeutralTaskProjectedModelRequest {
  const targetAllowlist = input.targetAllowlist ?? [];
  return {
    messages: input.messages.map((message) =>
      projectMessageForNeutralTaskProjection(message, targetAllowlist, input.onDiff),
    ),
    tools: input.tools.map(projectToolContractForNeutralTaskProjection),
  };
}