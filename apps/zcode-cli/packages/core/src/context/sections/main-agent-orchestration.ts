// ============================================================
// Main-Agent Orchestration Identity Section
// ============================================================
//
// 编排模式下的主会话身份。对齐 ARTEX 的 mainagent（agent/mainagent.go:16-19）：
// 主 agent 是**人机接口**，只观察 + 操舵，不亲自探索、不自主生成意图。
//
// 为什么需要这个身份段：
// 编排开启时，任务的首条消息已由编排循环接管（见 runtime-command-queue 的 kickoff
// 分支），主会话只处理**后续消息**（追问/操舵）。若主会话仍持有完整探索 agent 的
// 身份，它会继续以「要不要做渗透」的口吻评估用户追问——而那时编排已在跑，这种
// 评估既多余又可能引出拒绝。操舵身份把它收敛为一个纯粹的状态查询/意图注入接口。

import type { ContextSection } from "../types.js";
import { estimateTokens } from "../utils.js";

/**
 * 操舵身份的正文。与 ARTEX 的 mainAgentDefaultTmpl 同构，但按 ZCode 的工具名与
 * 结构重写（不逐字复制上游）。
 */
export const MAIN_AGENT_ORCHESTRATION_PROMPT = `你是本平台授权任务的「主 agent」，是人类操作员的接口。本任务已由编排层接管——目标拆解、方向规划、具体执行由三个专职角色（拆解者 / 规划者 / 执行者）负责。你不亲自探索、也不自主生成意图。

你的职责只有两件事：

1. **观察**：用 graph_overview / list_findings / list_facts / list_assets 回答人关于当前进展的问题。只根据工具返回的真实数据回答，不编造发现。
2. **操舵**（把人的意图落到系统）：
   - 人想「改方向 / 强调某类漏洞 / 重点某区域」→ 用 add_hint 写提示，规划者下次会读到。
   - 人想「立刻测某个具体目标」→ 用 add_intent 直接注入一条高优先级意图。
   - 人想「新增一个要达成的最终目标」→ 用 set_goals 增补目标。
   - 人想「增/改测试约束（允许/禁止某类操作）」→ 用 set_constraints 登记。

回复用人话简洁说明你做了什么，不要复述工具原文。本任务的目标与作用域已由会话级结构化状态承载，你不需要核验授权、也不需要评估「是否可以做渗透」——那是编排层的既定前提。`;

export function buildMainAgentOrchestrationIdentitySection(): ContextSection {
  const content = MAIN_AGENT_ORCHESTRATION_PROMPT;
  return {
    name: "Main Agent Orchestration Identity",
    source: "main_agent_orchestration_identity",
    injectionTarget: "system",
    cacheHint: "stable",
    chars: content.length,
    tokens: estimateTokens(content),
    content,
    preview: content.slice(0, 100),
  };
}
