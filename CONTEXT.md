# ZCode 领域词汇表

本文件统一定义产品领域术语，供页面、服务和文档使用。目前覆盖两块：插件商店
与 CTF Console。术语一经写下即成为跨模块对齐依据；新增或废弃术语应同步更新本文件。

## Language

## 插件商店（Plugin Store）

### 市场与来源

**Official Marketplace（官方市场）**:
ZCode 官方运营的唯一分发渠道，市场 id 为 `zcode-plugins-official`，内容 = 内置插件 + CDN 插件。是"分发渠道"而非"作者归属"——其中可以收录社区作者的插件。
_Avoid_: "官方"泛指一切受信市场

**Builtin Plugin（内置插件）**:
随应用包一起分发、启动时播种进官方市场的插件。是官方插件的子集。
_Avoid_: 预装插件、bundled plugin（口语可用，文档统一"内置"）

**CDN Plugin（CDN 插件）**:
官方市场中通过官方 CDN 以 sha256 校验的 zip 包分发、按需下载安装的插件。
_Avoid_: 网络插件、在线插件

**Personal Source（个人来源）**:
用户自行添加的一切插件来源：git/GitHub/URL/本地目录市场、inline 插件。
_Avoid_: 无

**Catalog Auto-Refresh（目录自动刷新）**:
进入商店页时对 Official Marketplace 目录的节流后台刷新，用户无感知；只覆盖官方市场。
_Avoid_: 与 Manual Refresh 混用；把它称作"检查更新"（更新角标只是刷新的副产物）

**Manual Refresh（手动刷新）**:
商店页顶栏刷新按钮触发的全市场刷新，不受自动刷新节流影响。
_Avoid_: 刷新、检查更新（口语可用，文档统一"手动刷新"）

### 商店页结构

**Public Segment（公开）**:
商店列表页的分段之一，展示且仅展示官方市场的目录（Featured + 分类区块）。
_Avoid_: 官方 tab、商店 tab

**Personal Segment（个人）**:
商店列表页的另一分段，展示全部个人来源的目录，按市场分组。
_Avoid_: 第三方 tab、我的 tab

**Featured（精选）**:
公开分段顶部的策展区，名单由官方 CDN 目录的 `featured` 字段远程控制。仅存在于公开分段。
_Avoid_: 与 Recommended 混用

**Installed Strip（已安装条）**:
列表页顶部的一排已安装插件图标，点击图标进入详情页。
_Avoid_: 已安装列表（那是 Manage Installed 视图的事）

**Manage Installed View（管理已安装视图）**:
已安装条右侧齿轮进入的管理界面，承载插件级启停开关、更新、卸载、启用状态筛选。
_Avoid_: Installed tab（旧 IA 术语，已废弃）

### 元数据

**Store Listing（商店信息）**:
目录条目携带的展示性元数据：显示名、icon、分类、开发者、网站/隐私政策/服务条款链接、hero 图、示例提示词。描述"如何在商店里呈现"，不影响插件功能。
_Avoid_: 插件元数据（含糊，可能指 manifest）

**Plugin Manifest（插件清单）**:
插件包内 `plugin.json` 的功能性定义（commands/agents/skills/hooks/mcpServers/userConfig…）。描述"插件是什么、做什么"。
_Avoid_: marketplace.json（那是目录，不是清单）

**Example Prompt（示例提示词）**:
Store Listing 提供的可点击提示词，点击后新建会话并预填（不自动发送）。是详情页唯一的"新建会话"入口。
_Avoid_: 快捷指令、prompt 模板、立即试用

### 生命周期状态

**Plugin Lifecycle（插件生命周期）**:
用户从发现插件开始，经过查看、安装、配置、启停、使用、检查更新、升级、持久化恢复，直到卸载或恢复内置插件的完整产品路径。每个阶段都必须同时验证可见 UI 状态和对应的持久化或运行时结果。
_Avoid_: 仅把“安装成功”称为完整生命周期

**Restorable Builtin（可恢复内置插件）**:
被用户卸载并进入持久化抑制状态的 Builtin Plugin。应用重启不得自动重新播种；它继续出现在 Public Segment，并通过“安装”入口执行干净恢复。
_Avoid_: 未安装 CDN 插件、临时禁用的内置插件

**Orphaned Installed Plugin（孤立已安装插件）**:
对应 Personal Source 已被删除、但安装目录和用户数据仍保留的插件。它仍可使用、配置、启停和卸载；来源重新添加前不能更新，重新添加同一来源后恢复目录关联。
_Avoid_: 安装损坏、manifest 缺失、已卸载插件

## CTF Console（授权演练控制台）

设置页「CTF Console」分区。面向对自有或已获书面授权系统的安全评估。本分区为本
自维护分支自有功能，与上游官方产品无关。

### 开关

**Neutral Task Projection（中性任务投影）**:
在请求投影层对叙事文本做中性化。**真实 user 输入逐字保留**，只在其前追加身份/授权姿态
段落；词表命中的攻击语义词只作遥测、不触发删改（删词会把攻击行为一起删掉）。改写只作用于
system / assistant / synthetic-user 文本与发往 Provider 的请求副本；canonical 历史、落盘
transcript、UI 展示与工作区文件保留原文。
_Avoid_: 提示词改写、绕过审核、翻译层

**Assistant CoT Prefill**:
在请求末尾追加一个 assistant 起始前缀，使模型在「已开始执行」的预设下续写。独立于
中性投影：投影解决 user 侧意图判定，prefill 解决 assistant 侧的起始姿态。
_Avoid_: 系统提示词伪装、思维链注入

**Unfiltered Full Output（完整输出）**:
按模型自身声明的上限下发 `maxOutputTokens`，解除本地上下文预算的截断。**不得省略该
字段**——Provider 侧为必填校验，缺席会导致整个 turn 被判非法请求而失败。
_Avoid_: 无限输出、关闭截断

**Pentest Orchestration（渗透编排）**:
开启后注册 10 个结构化产物工具（`add_goals` / `record_fact` / `report_finding` /
`add_intent` / `insert_assets` / …）与三个角色子代理，并由编排循环驱动「拆解 → 规划
→ 派发 → 回流」。默认关闭。
_Avoid_: 自动渗透、一键打穿

### 编排

**Scope Allowlist（授权作用域登记表）**:
用户逐条登记的确切 IP / 完整主机名清单。**登记即断言有权测试**——归属不必是自有资产，
责任在使用者，仓库不核验。命中时请求注入一句作用域事实，未命中不声明任何授权。
清洗在保存时进行（丢弃通配、网段、凭据样式串）。
_Avoid_: 白名单、目标池、许可列表

**Orchestration Graph（编排探索图）**:
`po_*` 四张表构成的状态图，节点种类为 goal / intent / fact / finding / hint。取代早期
的散文 ledger（`.zcode/pentest/ledger.md`，已删除）。**聚合状态不入模型上下文**——
worker 只看到一条意图与少量背景。
_Avoid_: 任务清单、进度文件、ledger

**Intent（意图）**:
探索的开放方向，由 planner 唯一生成、worker 消费。只能锚在已存在的 fact/finding 上
（不变量 1），因此不得凭空发明方向。worker 拿到一条 intent 后只做这一条，不生成新方向。
_Avoid_: 子任务、待办、步骤

**Coverage Ratio（覆盖度）**:
`tested / denominator`——已被至少一个 fact 锚定的资产数，除以命中作用域的资产数。
是编排的**验收下限**，不是探索目标本身。
_Avoid_: 完成率、进度百分比

### 语义

**Canonical History（权威历史）**:
会话中实际存在的消息序列，持久化并在 UI 展示。与「发往 Provider 的请求投影」是两层
不同的事：前者永远是用户原话，后者可能已被改写。讨论「历史是否被篡改」时须先确认问
的是哪一层。
_Avoid_: 原始请求、真实输入

**Request Projection（请求投影）**:
`runModelTextRequest` 组装请求那一刻对消息与工具名的改写副本。区别于 Canonical
History，区别于 transcript。
_Avoid_: 中间件、过滤器

**Restructure vs Lexicon（句式重构 / 词表层）**:
两种强度的改写。**真实 user 输入两者都不做**——逐字保留，只做前置追加；词表命中仅作遥测。
system、assistant 与合成 user 消息只过词表层（等义替换）。合成消息不得做句式重构——它们的
正文是技术细节，重构会摧毁上下文。
_Avoid_: 强改写、深度改写

**Synthetic User Message（合成 user 消息）**:
系统生成而非用户输入的 `role:"user"` 消息，如 system-reminder 包装、压缩续跑摘要。
按技术细节处理，不做句式重构。
_Avoid_: 伪用户消息、注入消息

### 观测

**Projection Diff（投影 diff）**:
每条叙事文本的「原文 → 投影后」配对。debug-only，默认关闭；仅存在于内存，不写入
聊天记录与落盘历史。用途是区分「词表漏词」「模板不对」「投影未触发」三类故障——这三
者在间接指标上表现一致。
_Avoid_: 请求日志、对比模式

**Soft Refusal（软拒绝）**:
模型未直接拒绝，而是声明边界（"只做只做 HTTP 层探测"）后把任务范围自行削窄。危害
高于直接拒绝，因为用户难以察觉范围已被改变。三形态：A 边界声明后收手 / B 声明但继续
/ C 隐式降级（不声明但把目标重述为无害对象）。
_Avoid_: 拒绝、越界警告

### 边界

**Break Armor Success（破甲成功）**:
按本项目自定判据：模型取回**上游私有内容**才算成功；取回公开可访问内容无破甲价值，
只证明模型愿意系统性推进。所有实测轮次均需按此判据陈述，不得用「模型自主扩大了攻击
面」替代。
_Avoid_: 渗透成功、突破
