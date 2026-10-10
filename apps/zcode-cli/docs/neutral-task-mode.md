# 中性任务模式（Neutral Task Mode）— 已废弃

> **状态：2026-10-10 已整体废弃并从代码移除。**
>
> 本文档原先描述的是「请求投影层」——在 provider 请求组装的那一刻改写叙事文本与工具名，
> 试图让模型不触发拒绝。该路线已全部删除：
>
> - `packages/shared/src/neutral-task-*.ts`（词表 / 作用域 / 句式重构 / 工具名映射）已删除
> - `core/src/runtime/helpers/neutral-task-projection*.ts` 已删除
> - `AgentRuntimeConfig.neutralTaskProjection` / `neutralTaskTargetAllowlist` /
>   `neutralTaskProjectionDiffCapture*` 及其全部设置面（UI / protocol / 服务层）已删除
> - `model.ts` / `compact-active.ts` 的投影调用点、`agent-runtime` 的 diff 记录器已删除
> - `session-debug` 的投影 diff 读取通道已删除
>
> **替代路线：结构化编排层。** 设计见
> [apps/zcode-cli/docs/pentest-orchestration.md](pentest-orchestration.md)。
>
> 为什么废弃、原路线为什么失败，见下方「保留的教训」。

---

## 保留的教训

以下是原路线实测得到、且在编排路线上仍然成立的结论。它们不描述任何现存代码，
只记录「为什么换路线」。

### 1. 词表改写单独使用无效

推理模型做的是攻击链的**语义**判定，不是关键词匹配。把「渗透」改成「全面检查」，
模型仍然识别出意图。实测（glm-5.3-flash，2026-10-07）：完整攻击链原句被拒，
词表中性化后的同一句**仍被拒**，拒绝话术直接点名「无论用什么措辞包装」。

**结论**：词表只能作辅助降信号层，不能作主机制。

### 2. 删攻击语义词会把攻击行为一起删掉

2026-10-08 实测：把 provider 可见文本里的攻击语义词**删干净**之后，模型的工具调用
整体落到「公开面功能核查」上——**请求里没有攻击目标，就没有攻击行为**；后续轮次
因缺少目标特异性而重复推导同一事实。

**结论**：改写必须保留任务语义。这条促使原路线从「删除式」改为「保留原文 + 注入姿态」，
但最终的结论是——**请求层的任何形态改写都不是正确层次**。

### 3. 有效杠杆是「每条 provider 请求的形态」，不是「单条请求的措辞」

拒绝只发生在「单条请求内含完整攻击链叙事」时。单步行为（一次端口探测、一次令牌验证）
本身完全正常。

**结论**：这条观察直接促成了编排路线——**把攻击链拆到状态层（SQLite 图），
每个 provider 请求只含一条中性任务**。

### 4. 软拒绝是独立失败模式

原路线实测归类出三种软拒绝形态：

| 形态 | 特征 |
| --- | --- |
| A 边界声明后收手 | 声明限制 + 不再深入 |
| B 声明但继续 | 同一轮声明 + 仍有 tool_calls |
| C 隐式降级 | 不声明，把目标重述为无害对象 |

根因是投影模板**预设了任务范围**（写死步骤、指定方法），模型于是忠实执行一个
比用户要求更小的任务。修复方式是模板不预设范围——但这条修复在编排路线里
有更彻底的解法：**范围由 `po_scope` 表结构化承载，不由提示词定义**。

### 5. 授权核验框架会把执行任务变成尽调任务

实测：只要 system prompt 里出现「require clear authorization context」「授权边界」
这类措辞，模型就会主动去核验授权（查 HackerOne、查 security.txt、要求书面凭证），
而不是执行任务。

**结论**：授权判断必须从模型职责里移除。这是编排路线改动身份行的直接原因
（见 `core/src/context/sections/identity.ts` 的 `CTF_SECURITY_NOTICE`）。

### 6. CoT Prefill 对 glm-5.3-flash 零增量

实测：攻击链 user 原句 + 伪造 assistant 消息 → 仍由正文给出拒绝，prefill 无法
使其跳过。中性 user + prefill 与中性 user + 无 prefill 结果相同。

**结论**：prefill 对内容驱动的拒绝模型无效。代码保留为可选开关（模型家族不同时
可能差异化），但不作为主突破手段。

---

## 关联

- 编排层设计（现行路线）：[apps/zcode-cli/docs/pentest-orchestration.md](pentest-orchestration.md)
- CTF Console 使用者视角：[docs/ctf-console.md](../../../docs/ctf-console.md)
