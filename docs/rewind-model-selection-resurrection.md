# 重提历史轮次时复活旧模型

> 状态：已实现（2026-10-09）。本文只描述我方实现。

## 1. 现象与复现

1. 用模型 A 完成若干轮对话
2. 删除模型 A，或在模型选择器里换成模型 B
3. 对**上一轮**执行「编辑」或「重试」
4. 请求仍发给模型 A（已删除/已换）→ 失败
5. 此后**普通发送也用 A**，只能**新建会话**才能恢复正常

## 2. 根因

`v4 editUserQuery / retryTurn` 走 `startCanonicalIntent`
（`zcode-protocol-v4/commands/handlers/fork-edit-retry.ts`）：

```ts
modelSelection: editTarget.intent.modelSelection,   // ← 历史那一轮当初的模型
```

`ConversationEditTarget.intent` 在投影登记时由 **CanonicalUserIntentFact** 生成
（`product-projection.ts:2191`：`...(fact.modelSelection ? { modelSelection: fact.modelSelection })`）。
它记录的是**那一轮提交时**用了什么模型，是历史事实，不是当前意图。

到了 `applySubmissionExecutionState`（`core/src/runtime/methods/turn-model.ts:51-70`）：

```ts
const selection = intent?.modelSelection;
if (selection) {
  if (modelExecution?.selectionScope !== "execution") {
    const appliedSelection = cloneModelSelection(selection);
    runtime.setSessionModelSelection(appliedSelection);      // ← 覆盖当前选择
    await persistRuntimeModelSelection(runtime, appliedSelection);  // ←  durable 覆盖
```

于是旧模型不只是被用于这一轮，还**持久写回** `session_entry: runtime/model_selection`。
一次误提 → 会话的模型选择被永久改写成旧模型 → 后续每一轮都发往旧模型 →
只有新会话（无 edit target、无历史选择）能恢复。这与报障现象完全吻合。

### 为什么校验拦不住

`startPromptTurn` 在提交前调 `ensureModelReady`，但它校验的是**当前** runtime 选择。
`applySubmissionExecutionState` 在这之后才把 intent 里的旧选择覆盖上去。
顺序本身没问题——问题是被覆盖的值来自历史，不是用户当前意图。

### 同源的第二条路径

`inputIntentMetadataFromQueueItem`（`commands/input-intent.ts:119`）把队列项
**入队时**的 `modelSelection` 原样带进 intent。于是「用 A 排队 → 换成 B →
队列排出/立即发送」同样发往 A。与 rewind 路径是同一个失效模式。

## 3. 判定规则

**重新提交一个已受理的意图时（edit / retry / 队列排出），模型一律取会话当前选择，
不复活该意图当初绑定的选择。**

理由：

- 历史 intent 的 modelSelection 描述的是「那一轮用了什么」，是审计事实；
  它不是「现在该用什么」。
- 复活它不只是用错一次，还会**durable 覆盖**会话选择，故障不可自愈。
- 与仓库既有取舍一致：`zcodeTaskServiceAdapter.ts:1796-1803` 为同一个失效模式
  （「draft 可能仍停在预热时的旧模型」）修过一轮，做法就是显式同步到当前选择。

有意**不**保留的历史字段：`mode` / `planEnabled` / 文本 / 附件 / queueItemId /
provenance——这些描述「这一轮本身」，retry 理应复现。模型不在此列，
因为它是用户随时可改的**会话级**偏好，不是turn 的属性。

## 4. 改动

| 文件                                                 | 改动                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `fork-edit-retry.ts` `startCanonicalIntent`          | 不再传 `editTarget.intent.modelSelection`；缺省让 `createTurnModel` 回退到 `runtime.getSessionModelSelection()` |
| `input-intent.ts` `inputIntentMetadataFromQueueItem` | 不再带 `item.modelSelection`                                                                                    |

`applySubmissionExecutionState` / `createTurnModel` **不改**：缺省 `selection` 时
`createTurnModel` 已经会回退当前会话选择（`turn-model.ts:22`），且
`modelExecution.selectionScope === "execution"` 的显式执行范围覆盖路径不受影响。

## 5. 不变量

1. **当前选择权威**：任何重提路径都不改写会话的持久模型选择。
2. **显式执行范围不受影响**：`modelExecution.selectionScope === "execution"`
   仍由调用方显式指定选择，与本 spec 无关。
3. **新建会话/首发路径不受影响**：`createSession.firstInput` /
   `createSelectionSideSession.firstInput` 仍按调用方请求的选择创建。
4. **不改校验顺序**：`ensureModelReady` 的位置与语义不变。

## 6. 验收场景

| #   | 场景                                                         | 期望                             |
| --- | ------------------------------------------------------------ | -------------------------------- |
| S1  | 用 A 跑一轮 → 删 A / 换成 B → retry 那一轮                   | 请求发往 B；会话当前选择仍为 B   |
| S2  | S1 之后**普通发送**一条新消息                                | 仍发往 B（不被 S1 污染）         |
| S3  | 用 A 跑一轮 → 换 B → edit 那一轮文本重发                     | 发往 B                           |
| S4  | 用 A 排队一条 → 换 B → 队列排出                              | 发往 B                           |
| S5  | 会话未换模型，retry/编辑/排队排出                            | 发往当前选择（行为与修复前一致） |
| S6  | `modelExecution.selectionScope === "execution"` 显式指定选择 | 仍用显式选择（不回归）           |

## 7. 未验证

- **无自动化测试入口**：仓库内不存在任何 `*.test.tsx`；本章改动落在 v4 命令层，
  也没有现成的命令级测试台。S1–S6 需实机人工验证。
- **未处理**：用户因本 bug 而已被污染的会话，其持久化的 `runtime/model_selection`
  仍是旧模型。本 spec 只保证不再发生，不提供就地修复。受影响的会话要么手动切一次
  模型，要么新建会话。
