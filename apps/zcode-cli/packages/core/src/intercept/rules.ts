// 内置拦截规则——逐条对齐 ARTEX db/db.go 的 seedDefaultInterceptRules v1/v2/v3。
//
// 设计纪律（与 ARTEX 一致）：
//   · 规则是普通数据，用户可禁用/删除（后续接 DB 后）；
//   · 种子由「已播种」标记门控，用户改动不被重启覆盖；
//   · 匹配对象是工具参数原文（tool_input）或工具名（tool_name），**不含意图**；
//   · 只拦「难以恢复的破坏」，正常渗透动作（注入探测、读文件、爆破、提权侦察）全部放行。

import type { InterceptRule } from "./types.js";

/** 规则 id 分配：内置规则用固定 id，用户规则从 10000 起。 */
type BuiltinRule = Omit<InterceptRule, "id" | "timeoutEnabled" | "timeoutSeconds" | "timeoutAction"> & {
  timeoutEnabled?: boolean;
  timeoutSeconds?: number;
  timeoutAction?: "allow" | "deny";
};

/**
 * v1 规则（对齐 ARTEX db.go:518-679）。
 * 覆盖：系统破坏性命令（100）、数据库破坏（90）、HTTP 删除请求（80）。
 */
const V1_RULES: BuiltinRule[] = [
  // ── 系统破坏性命令 (priority 100) ──
  {
    name: "[内置] 递归强制删除 rm -rf",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\brm\b.{0,80}(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|--recursive|--no-preserve-root)`,
    action: "deny",
    message: "禁止执行递归强制删除（rm -rf / rm --recursive），可能永久损坏系统或靶机环境",
  },
  {
    name: "[内置] 删除系统关键目录",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\brm\b[^"'\n]{0,60}["'\s](/|/etc|/bin|/usr|/boot|/var|/lib|/sys|/proc|/dev|/sbin|/root)`,
    action: "deny",
    message: "禁止删除系统关键路径",
  },
  {
    name: "[内置] 磁盘格式化 mkfs",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\bmkfs\b`,
    action: "deny",
    message: "禁止格式化磁盘（mkfs）",
  },
  {
    name: "[内置] 覆写磁盘设备 dd",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\bdd\b[^|\n]{0,100}\bof=\s*/dev/[a-zA-Z]`,
    action: "deny",
    message: "禁止使用 dd 覆写磁盘设备",
  },
  {
    name: "[内置] Fork 炸弹",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`:(){ :|:& };:`,
    action: "deny",
    message: "禁止执行 Fork 炸弹",
  },
  {
    name: "[内置] 关机 / 重启",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\b(?:shutdown|reboot|halt|poweroff|init\s+[06])\b`,
    action: "deny",
    message: "禁止执行关机或重启命令",
  },
  {
    name: "[内置] 杀死全部进程",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\bkill\s+-9\s+-1\b|\bkillall\s+-9\b`,
    action: "deny",
    message: "禁止 kill -9 -1 或 killall -9（杀死所有进程）",
  },
  {
    name: "[内置] 磁盘擦除 shred / wipe",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\b(?:shred|wipe)\b[^|\n]{0,80}/dev/[a-zA-Z]`,
    action: "deny",
    message: "禁止对磁盘设备执行 shred/wipe 擦除",
  },
  {
    name: "[内置] 清空防火墙规则",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\biptables\s+(?:-F|--flush)\b|\bnft\s+flush\s+ruleset\b`,
    action: "deny",
    message: "禁止清空防火墙规则（iptables -F / nft flush）",
  },
  // ── 数据库破坏性操作 (priority 90) ──
  {
    name: "[内置] SQL DROP DATABASE / TABLE / SCHEMA",
    enabled: true,
    priority: 90,
    matchTarget: "tool_input",
    matchType: "regex",
    // 注意：JS 用 new RegExp(pattern, "i") 加 ignoreCase，pattern 里**不能**再带
    // Go 的 `(?i)` 内联标志——那在 JS 里是非法组，会让整个正则编译失败、规则被静默跳过。
    pattern: String.raw`\bDROP\s+(?:DATABASE|TABLE|SCHEMA|INDEX|VIEW|TABLESPACE|USER|ROLE)\b`,
    action: "deny",
    message: "禁止执行 DROP 操作，可能不可逆地销毁数据库对象",
  },
  {
    name: "[内置] SQL TRUNCATE",
    enabled: true,
    priority: 90,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\bTRUNCATE\s+(?:TABLE\s+)?\w`,
    action: "deny",
    message: "禁止执行 TRUNCATE，可能清空数据表所有数据",
  },
  {
    name: "[内置] MongoDB drop / dropDatabase",
    enabled: true,
    priority: 90,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\.(?:dropDatabase|dropCollection|drop)\s*\(`,
    action: "deny",
    message: "禁止执行 MongoDB drop 操作",
  },
  {
    name: "[内置] Redis FLUSHALL / FLUSHDB",
    enabled: true,
    priority: 90,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\b(?:FLUSHALL|FLUSHDB)\b`,
    action: "deny",
    message: "禁止执行 Redis FLUSHALL / FLUSHDB，可能清空全部缓存数据",
  },
  // ── HTTP 破坏性请求 (priority 80) ──
  {
    name: "[内置] curl / wget 发送 DELETE 请求",
    enabled: true,
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\bcurl\b[^|\n&;"]{0,300}(?:-X\s*DELETE|--request\s+DELETE|-XDELETE)|\bwget\b[^|\n&;"]{0,300}--method[=\s]+DELETE`,
    action: "deny",
    message: "禁止通过 curl/wget 发送 HTTP DELETE 请求，可能删除目标系统数据",
  },
  {
    name: "[内置] Python HTTP 客户端 DELETE",
    enabled: true,
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\b(?:requests|httpx|aiohttp|urllib\.request)\.delete\s*\(|session\.delete\s*\(|client\.delete\s*\(`,
    action: "deny",
    message: "禁止使用 Python HTTP 客户端发送 DELETE 请求",
  },
  {
    name: "[内置] 脚本中声明 HTTP DELETE 方法（JS/通用）",
    enabled: true,
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`axios\.delete\s*\(|method\s*[:=]\s*['"]DELETE['"]`,
    action: "deny",
    message: "禁止在脚本中声明并发送 HTTP DELETE 请求",
  },
  {
    name: "[内置] 批量清空 / 清除接口路径",
    enabled: true,
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`/(?:clear|wipe|flush|purge|truncate|drop|destroy|factory[-_]reset|reset[-_]all)(?:[/?#"'\s]|$)`,
    action: "deny",
    message: "禁止调用批量清空或销毁类接口（/clear /wipe /flush /purge 等）",
  },
];

/**
 * v2 规则（对齐 ARTEX db.go:700-740）。
 * 注意「数据外泄管道」**默认 disabled**——ARTEX 的原注释：
 *   its curl/wget/nc pipe pattern mis-fires on legitimate CTF/pentest
 *   reverse-shell and data-transfer pipes; enable it manually when exfil
 *   gating is actually wanted.
 */
const V2_RULES: BuiltinRule[] = [
  {
    name: "[内置] 破坏性系统命令",
    enabled: true,
    priority: 100,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`\b(rm\s+-rf\s+/|mkfs|dd\s+if=|:\(\)\s*\{|shutdown|reboot|>\s*/dev/sd)`,
    action: "deny",
    message: "破坏性命令被拒绝（rm -rf / / mkfs / dd / fork bomb / 关机重启 / 覆写磁盘设备）",
  },
  {
    name: "[内置] 数据外泄管道",
    enabled: false, // 默认关闭（对齐 ARTEX）
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: String.raw`(curl|wget|nc|ncat)\b[^|]*\b(\|\s*(curl|wget|nc))`,
    action: "deny",
    message: "疑似数据外泄管道被拒绝（命令输出经 curl/wget/nc 外传）",
  },
];

/**
 * v3 规则（对齐 ARTEX db.go:756-774）。
 * 覆盖「用 GET/POST 触发的删除接口」——v1 的 HTTP 规则只拦 DELETE *方法*，
 * 而多数 web 应用的删除接口用 GET/POST 就能触发。
 */
const DELETE_ENDPOINT_PATH_PATTERN = String.raw`/(?:(?:delete|remove|unlink|erase|destroy)[-\w]*|del)(?:[/?#"'\s]|$)`;

const V3_RULES: BuiltinRule[] = [
  {
    name: "[内置] 删除类接口路径",
    enabled: true,
    priority: 80,
    matchTarget: "tool_input",
    matchType: "regex",
    pattern: DELETE_ENDPOINT_PATH_PATTERN,
    action: "deny",
    message:
      "禁止调用删除类接口（/delete /remove /unlink /erase 等），不论使用哪种 HTTP 方法——" +
      "多数应用的删除接口用 GET/POST 就能触发，同样会真实删除目标数据",
  },
];

/** 全部内置规则，已补齐 timeout 字段与 id。 */
export const DEFAULT_INTERCEPT_RULES: InterceptRule[] = [
  ...V1_RULES,
  ...V2_RULES,
  ...V3_RULES,
].map((rule, index) => ({
  ...rule,
  id: index + 1,
  timeoutEnabled: rule.timeoutEnabled ?? false,
  timeoutSeconds: rule.timeoutSeconds ?? 60,
  timeoutAction: rule.timeoutAction ?? "deny",
}));

/**
 * 工具白名单：只有这些工具进拦截路径。对齐 ARTEX intercept.go:159-163。
 *
 * 为什么是白名单而非黑名单：编排产物工具（add_goals / record_fact /
 * report_finding / insert_assets 等）根本不经过拦截——这是「默认放行」的
 * 机械实现，也避免误伤结构化产出。
 */
export const DEFAULT_ENABLED_TOOLS: readonly string[] = [
  "Bash",
  "WebFetch",
  "web_search",
  "shell_open",
  "shell_send",
  "Write",
  "Edit",
  "MultiEdit",
];

/** 导出供测试使用的模式常量。 */
export const INTERCEPT_PATTERNS = {
  deleteEndpointPath: DELETE_ENDPOINT_PATH_PATTERN,
} as const;
