/**
 * 中性任务投影 —— 工具名映射（shared 单一事实来源）。
 *
 * 文本层（词表 / 输入侧重构 / 残留自检）见 `neutral-task-lexicon`、
 * `neutral-task-turn-input`、`neutral-task-terms`。core 与 UI 预览面板共用
 * `@zcode/shared` 的同一份代码，保证「预览即真实」。
 *
 * 这里的函数全部零依赖、无 IO；core 侧的投影不变量见
 * apps/zcode-cli/packages/core/src/runtime/helpers/neutral-task-projection.ts
 * 文件头。
 */

/** 工具名 token 别名表：单射（一个原文只对应一个别名，入站还原才无歧义）。 */
const NEUTRAL_TOOL_NAME_TOKEN_ALIASES: ReadonlyMap<string, string> = new Map([
  ["metasploit", "modaudit"],
  ["msfconsole", "modconsole"],
  ["cobaltstrike", "cbsuite"],
  ["nmap", "netprobe"],
  ["masscan", "netsweep"],
  ["nuclei", "templateprobe"],
  ["subfinder", "domaincheck"],
  ["sqlmap", "dbprobe"],
  ["sqlninja", "dbaudit"],
  ["nikto", "webaudit"],
  ["gobuster", "dirfuzz"],
  ["dirb", "dirdict"],
  ["ffuf", "dirscan"],
  ["hydra", "credprobe"],
  ["medusa", "credscan"],
  ["ncrack", "credcrack"],
  ["hashcat", "hashcheck"],
  ["john", "crackcheck"],
  ["wireshark", "pcapreview"],
  ["tshark", "pcapprobe"],
  ["mitmproxy", "trafficproxy"],
  ["ettercap", "trafficrelay"],
  ["bettercap", "caprelay"],
  ["responder", "netrelay"],
  ["aircrack", "wirelesscheck"],
  ["nessus", "scansuite"],
  ["openvas", "auditsuite"],
  ["kirby", "flatfileprobe"],
  ["joomscan", "cmsprobe"],
]);

const NEUTRAL_TOOL_NAME_TOKEN_PATTERN = buildTokenPattern(
  [...NEUTRAL_TOOL_NAME_TOKEN_ALIASES.keys()].sort((left, right) => right.length - left.length),
);
const NEUTRAL_TOOL_NAME_RESTORE_PATTERN = buildTokenPattern(
  [...NEUTRAL_TOOL_NAME_TOKEN_ALIASES.values()].sort((left, right) => right.length - left.length),
);
const NEUTRAL_TOOL_NAME_RESTORE_MAP: ReadonlyMap<string, string> = new Map(
  [...NEUTRAL_TOOL_NAME_TOKEN_ALIASES].map(([token, alias]) => [alias, token]),
);

/** token 两侧用「非字母数字」作为边界，而不是 `\b`：工具名里的 `_` 是单词字符。 */
function buildTokenPattern(tokens: readonly string[]): RegExp {
  return new RegExp(`(?<![a-z0-9])(${tokens.join("|")})(?![a-z0-9])`, "gi");
}

export function projectToolNameForNeutralTaskProjection(name: string): string {
  if (!name) return name;
  return name.replace(
    NEUTRAL_TOOL_NAME_TOKEN_PATTERN,
    (token) => NEUTRAL_TOOL_NAME_TOKEN_ALIASES.get(token.toLowerCase()) ?? token,
  );
}

/** 入站还原：provider 回传的 tool_call.name 必须先还原成注册表规范名。 */
export function restoreToolCallNameForNeutralTaskProjection(name: string): string {
  if (!name) return name;
  return name.replace(
    NEUTRAL_TOOL_NAME_RESTORE_PATTERN,
    (token) => NEUTRAL_TOOL_NAME_RESTORE_MAP.get(token.toLowerCase()) ?? token,
  );
}
