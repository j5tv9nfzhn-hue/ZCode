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
 * 叙事层中性化：**真实** user 消息走输入侧重构（句式级）；其余一律只过词表层。
 * - 合成 user 消息（system-reminder 包装 / compact 续跑摘要）只过词表层：
 *   它们的正文是技术细节，重构会摧毁上下文（见 isSyntheticUserMessageText）。
 * - system / assistant 保持既有行为，避免把模型已生成的任务书再重构。
 */
function projectNarrativeContentForNeutralTaskProjection(
  message: ModelInputMessage,
): ModelInputMessage["content"] {
  const restructureUserText =
    message.role === "user"
      ? (text: string): string =>
          isSyntheticUserMessageText(text)
            ? neutralizeTextForNeutralTaskProjection(text)
            : normalizeTurnInputForNeutralTaskMode(text).text
      : neutralizeTextForNeutralTaskProjection;
  const content = message.content;
  if (typeof content === "string") {
    return restructureUserText(content);
  }
  // 文本块形态的 user 输入（带附件的多块消息）同样走同一判定；
  // 非 text 块由内容投影逐块处理。
  return content.map((block) =>
    block.type === "text"
      ? { ...block, text: restructureUserText(block.text) }
      : projectContentBlockForNeutralTaskProjection(block),
  );
}

function projectMessageForNeutralTaskProjection(message: ModelInputMessage): ModelInputMessage {
  // 不变量 2 的机器可判定分支：tool-result 的正文是真实观测，不改写；
  // 叙事层（system / user / assistant 文本）才做中性化。
  const isToolResult = message.role === "tool" || typeof message.toolCallId === "string";
  const content = isToolResult
    ? message.content
    : projectNarrativeContentForNeutralTaskProjection(message);
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
 * provider 请求投影：把「历史 + 系统提示词 + 工具定义」整体中性化。
 * 只在 AgentRuntimeConfig.neutralTaskProjection 开启时由 runModelTextRequest
 * 调用；返回的是副本，canonical 历史不受影响。
 */
export function projectModelRequestForNeutralTaskProjection(input: {
  messages: readonly ModelInputMessage[];
  tools: readonly ModelToolContract[];
}): NeutralTaskProjectedModelRequest {
  return {
    messages: input.messages.map(projectMessageForNeutralTaskProjection),
    tools: input.tools.map(projectToolContractForNeutralTaskProjection),
  };
}