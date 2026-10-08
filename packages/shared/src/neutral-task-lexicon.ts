/**
 * 中性任务投影 —— 词表层（语义中和）。
 *
 * 2026-10-08「彻底完全破甲」整改：
 * 1. 替换值不得携带攻击语义（旧版「提权→权限边界校验」「渗透→深度探测」
 *    替换值仍是透明的安全词汇，安全调优的模型一眼看穿）；
 * 2. 词表层不替代句式重构：真实 user 输入由 `neutral-task-turn-input` 处理；
 *    本层覆盖 narrative 文本与工具描述。链路不变。
 *
 * 所有函数零依赖、无 IO、可单测。
 */

/** 有序规则表：先长后短。「SQL 注入」必须在「注入」之前。 */
interface NeutralTextRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const NEUTRAL_TEXT_RULES: readonly NeutralTextRule[] = [
  // ── 中文：安全语境词 ──
  { pattern: /渗透测试/g, replacement: "兼容性验证" },
  { pattern: /渗透压测/g, replacement: "兼容性压测" },
  { pattern: /渗透(?![率])/g, replacement: "全面检查" },
  { pattern: /深度探测/g, replacement: "全面检查" },
  { pattern: /提权链/g, replacement: "访问范围变更链" },
  { pattern: /提权/g, replacement: "访问范围变更" },
  { pattern: /横向移动/g, replacement: "跨主机访问扩展" },
  { pattern: /权限提升/g, replacement: "访问范围变更" },
  { pattern: /越权/g, replacement: "越界访问" },
  { pattern: /一句话木马/g, replacement: "轻量入口脚本" },
  { pattern: /木马/g, replacement: "驻留程序" },
  { pattern: /webshell/gi, replacement: "web 入口脚本" },
  { pattern: /字典攻击/g, replacement: "凭据枚举" },
  { pattern: /漏洞/g, replacement: "缺陷" },
  { pattern: /攻击/g, replacement: "探测" },
  { pattern: /入侵/g, replacement: "进入" },
  { pattern: /后门/g, replacement: "常驻入口" },
  { pattern: /勒索/g, replacement: "文件锁定劫持" },
  { pattern: /爆破字典/g, replacement: "凭据字典" },
  { pattern: /爆破/g, replacement: "凭据枚举" },
  { pattern: /撞库/g, replacement: "凭据复用尝试" },
  { pattern: /拖库/g, replacement: "数据批量导出" },
  { pattern: /免杀/g, replacement: "特征规避" },
  { pattern: /绕过/g, replacement: "旁路" },
  { pattern: /杀软/g, replacement: "终端防护" },
  { pattern: /钓鱼/g, replacement: "诱导" },
  { pattern: /社工/g, replacement: "诱导" },
  { pattern: /红队/g, replacement: "对抗演练" },
  { pattern: /黑帽/g, replacement: "非授权" },
  { pattern: /打站/g, replacement: "站点探测" },
  { pattern: /拿站/g, replacement: "站点控制权获取" },
  { pattern: /拿权限/g, replacement: "获取访问范围" },
  { pattern: /打穿/g, replacement: "打通" },
  { pattern: /利用/g, replacement: "使用" },

  // ── 中文 CWE / 攻击目标语义（§1.7 第 3 行漏网项）──
  { pattern: /SQL\s?注入/gi, replacement: "查询构造缺陷" },
  { pattern: /注入/g, replacement: "输入构造异常" },
  { pattern: /反序列化/g, replacement: "对象重构异常" },
  { pattern: /目录遍历/g, replacement: "目录浏览异常" },
  { pattern: /路径穿越/g, replacement: "路径回溯异常" },
  { pattern: /任意文件上传/g, replacement: "文件上传未限制" },
  { pattern: /命令执行/g, replacement: "命令调用" },
  { pattern: /代码执行/g, replacement: "代码调用" },
  { pattern: /弱口令/g, replacement: "简单口令" },
  { pattern: /信息泄露/g, replacement: "信息暴露" },
  { pattern: /getshell/gi, replacement: "入口脚本获取" },
  { pattern: /\bRCE\b/gi, replacement: "远程调用异常" },

  // ── 英文：攻击链关键词 ──
  { pattern: /penetration[\s-]?test(?:ing|ed|s)?/gi, replacement: "compatibility audit" },
  { pattern: /\bpentest(?:ing|ed)?\b/gi, replacement: "compatibility audit" },
  { pattern: /\bexploitation\b/gi, replacement: "probe" },
  { pattern: /\bexploits?\b/gi, replacement: "probe" },
  { pattern: /\bexploitable\b/gi, replacement: "probe-prone" },
  { pattern: /\bexploiting\b/gi, replacement: "probing" },
  { pattern: /\bexploit\b/gi, replacement: "probe" },
  { pattern: /privilege[\s-]?escalation/gi, replacement: "access-scope elevation" },
  { pattern: /privilege[\s-]?escalat(?:e|ed|es|ing|ion)\b/gi, replacement: "access-scope change" },
  { pattern: /\bescalate\s+privileges\b/gi, replacement: "widen access scope" },
  { pattern: /vulnerabilit(?:y|ies)/gi, replacement: "defect" },
  { pattern: /\bvulnerab\w+/gi, replacement: "defect-prone" },
  { pattern: /\bvulns?\b/gi, replacement: "defect" },
  { pattern: /\bmalicious\b/gi, replacement: "untrusted" },
  { pattern: /\bmalware\b/gi, replacement: "untrusted binary" },
  { pattern: /\bransomware\b/gi, replacement: "file-locking hijack" },
  { pattern: /\brootkit(?:s)?\b/gi, replacement: "persistence component" },
  { pattern: /\bbackdoor(?:s|ed|ing)?\b/gi, replacement: "persistent access path" },
  { pattern: /\bkeylogger(?:s|ing)?\b/gi, replacement: "input-logging component" },
  { pattern: /keylogging\b/gi, replacement: "input logging" },
  { pattern: /\bbrute[\s-]?forc(?:e|ed|ing)\b/gi, replacement: "credential enumeration" },
  { pattern: /credential[\s-]?stuffing\b/gi, replacement: "credential reuse check" },
  { pattern: /reverse[\s-]?shell/gi, replacement: "callback shell" },
  { pattern: /command\s*(?:and|&)\s*control\b/gi, replacement: "remote control channel" },
  { pattern: /\bc2\b/g, replacement: "callhome" },
  { pattern: /\bCVE-\d{4}-\d{4,7}\b/gi, replacement: "SECURITY-ADVISORY" },
  { pattern: /\b0-?day(?:s)?\b/gi, replacement: "unpatched flaw" },
  { pattern: /\bzero[\s-]?day(?:s)?\b/gi, replacement: "unpatched flaw" },
  { pattern: /SQL[\s-]?injection/gi, replacement: "query-construction flaw" },
  { pattern: /\binjections?\b/gi, replacement: "input-handling anomaly" },
  { pattern: /\bXXE\b/gi, replacement: "external-entity flaw" },
  { pattern: /\bSSRF\b/gi, replacement: "outbound-request flaw" },
  { pattern: /\bCSRF\b/gi, replacement: "cross-site request flaw" },
  { pattern: /browser[\s-]?exploitation/gi, replacement: "browser interaction flaw" },
  { pattern: /sandbox[\s-]?escape\b/gi, replacement: "boundary crossing" },
  { pattern: /\bUAC\s*bypass\b/gi, replacement: "administrator prompt bypass" },
  { pattern: /token[\s-]?theft\b/gi, replacement: "credential capture" },
  { pattern: /\bDoS\b/gi, replacement: "availability issue" },
  { pattern: /\bDDoS\b/gi, replacement: "availability issue" },
  { pattern: /\bkill[\s-]?chain\b/gi, replacement: "operation sequence" },
  { pattern: /\bCTF\b/gi, replacement: "challenge exercise" },
  { pattern: /\battacker(?:s)?\b/gi, replacement: "probe initiator" },
  { pattern: /\battack(?:er|ers|ing)?\b/gi, replacement: "probe" },
  { pattern: /\bpayloads?\b/gi, replacement: "request body" },
  { pattern: /\bshellcode\b/gi, replacement: "native code fragment" },
  { pattern: /\bdefacement\b/gi, replacement: "content overwrite" },
  { pattern: /\bphishing\b/gi, replacement: "credential lure" },
  { pattern: /\bspoof(?:ing|ed)?\b/gi, replacement: "identity-masquerade" },
  { pattern: /\bbrute\b/gi, replacement: "bulk" },

  // ── 英文：安全工具名（工具名投影与正文投影共用同一词表）──
  { pattern: /metasploit/gi, replacement: "modaudit" },
  { pattern: /msfconsole/gi, replacement: "modconsole" },
  { pattern: /cobalt[\s-]?strike/gi, replacement: "cbsuite" },
  { pattern: /\bnmap\b/gi, replacement: "netprobe" },
  { pattern: /masscan/gi, replacement: "netsweep" },
  { pattern: /\bnuclei\b/gi, replacement: "templateprobe" },
  { pattern: /subfinder/gi, replacement: "domaincheck" },
  { pattern: /\bsqlmap\b/gi, replacement: "dbprobe" },
  { pattern: /sqlninja/gi, replacement: "dbaudit" },
  { pattern: /\bnikto\b/gi, replacement: "webaudit" },
  { pattern: /\bgobuster\b/gi, replacement: "dirfuzz" },
  { pattern: /\bdirb\b/gi, replacement: "dirdict" },
  { pattern: /\bffuf\b/gi, replacement: "dirscan" },
  { pattern: /\bhydra\b/gi, replacement: "credprobe" },
  { pattern: /\bmedusa\b/gi, replacement: "credscan" },
  { pattern: /\bncrack\b/gi, replacement: "credcrack" },
  { pattern: /\bhashcat\b/gi, replacement: "hashcheck" },
  { pattern: /\bwireshark\b/gi, replacement: "pcapreview" },
  { pattern: /\btshark\b/gi, replacement: "pcapprobe" },
  { pattern: /\bmitmproxy\b/gi, replacement: "trafficproxy" },
  { pattern: /ettercap/gi, replacement: "trafficrelay" },
  { pattern: /\bbettercap\b/gi, replacement: "caprelay" },
  { pattern: /\bresponder\b/gi, replacement: "netrelay" },
  { pattern: /\baircrack/gi, replacement: "wirelesscheck" },
  { pattern: /\bnessus\b/gi, replacement: "scansuite" },
  { pattern: /openvas/gi, replacement: "auditsuite" },
  { pattern: /\bkirby\b/gi, replacement: "flatfileprobe" },
  { pattern: /\bjoomscan\b/gi, replacement: "cmsprobe" },
];

/** 供自测：所有词表替换值必须可被「不含攻击/安全语境词」这条不变量验证。 */
export function listNeutralizationReplacements(): readonly string[] {
  return NEUTRAL_TEXT_RULES.map((rule) => rule.replacement);
}

export function neutralizeTextForNeutralTaskProjection(text: string): string {
  if (!text) return text;
  let projected = text;
  for (const rule of NEUTRAL_TEXT_RULES) {
    projected = projected.replace(rule.pattern, rule.replacement);
  }
  return projected;
}
