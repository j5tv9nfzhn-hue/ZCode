/**
 * 中性任务投影 —— 攻击语境词表与残留扫描（shared 单一事实来源）。
 *
 * "彻底完全破甲"的判据集中收口在这里：
 * 1. `TURN_INPUT_SECURITY_CONTEXT_TERMS` —— 句式重构的「含目标实体 + 含任一
 *    安全语境词」组合判定用同一份词表（§1.7 整改前漏报的直接原因是孤立
 *    触发词表；新词必须同步进来）。
 * 2. `findResidualAttackTerms` —— 句式重构产物与词表替换结果的自检口径必须
 *    与触发判定同源，否则「绕过触发词但仍带攻击语义」会再次漏网。
 *
 * 所有函数零依赖、无 IO、可单测。
 */

/**
 * 安全语境词：出现即视为该输入带「安全评估 / 攻击执行」语义。
 * 增量原则：凡在 narrative / provider 请求里不希望出现的攻击目标语义词都在此。
 * 注意：**词表层的替换值不得包含本表词汇**（否则会把攻击语义「官文化」后
 * 原样发出），由 test 硬性约束——不要把替换值写成「凭据枚举」「入口脚本」…。
 */
export const TURN_INPUT_SECURITY_CONTEXT_TERMS: readonly string[] = [
  // 中文
  "渗透",
  "打穿",
  "攻破",
  "打下来",
  "拿下",
  "拿权限",
  "入侵",
  "搞掉",
  "控制这台",
  "越权",
  "提权",
  "横向移动",
  "权限提升",
  "红队",
  "黑帽",
  "打站",
  "拿站",
  "木马",
  "一句话木马",
  "webshell",
  "字典攻击",
  "漏洞",
  "攻击",
  "后门",
  "勒索",
  "爆破",
  "撞库",
  "拖库",
  "免杀",
  "绕过",
  "杀软",
  "钓鱼",
  "社工",
  "SQL 注入",
  "注入",
  "反序列化",
  "目录遍历",
  "路径穿越",
  "任意文件上传",
  "命令执行",
  "代码执行",
  "弱口令",
  "信息泄露",
  "SSRF",
  "XSS",
  "XXE",
  "RCE",
  "getshell",
  "深度探测",
  "打点",
  "踩点",
  "资产测绘",
  "内网穿透",
  "权限维持",
  "持久化",
  "0day",
  // 英文
  "exploit",
  "pentest",
  "penetration",
  "hack",
  "pwn",
  "attack",
  "attack chain",
  "break into",
  "vulnerability",
  "vulnerabilities",
  "vuln",
  "malicious",
  "malware",
  "ransomware",
  "rootkit",
  "backdoor",
  "keylogger",
  "brute force",
  "credential stuffing",
  "reverse shell",
  "command and control",
  "sql injection",
  "xss",
  "xxe",
  "ssrf",
  "csrf",
  "payload",
  "shellcode",
  "defacement",
  "phishing",
  "spoofing",
  "privilege escalation",
  "dos",
  "ddos",
  "zero day",
  "0day",
  "metasploit",
  "msfconsole",
  "cobalt strike",
  "nmap",
  "masscan",
  "nuclei",
  "subfinder",
  "sqlmap",
  "sqlninja",
  "nikto",
  "gobuster",
  "dirb",
  "ffuf",
  "hydra",
  "medusa",
  "ncrack",
  "hashcat",
  "wireshark",
  "tshark",
  "mitmproxy",
  "ettercap",
  "bettercap",
  "responder",
  "aircrack",
  "nessus",
  "openvas",
  "kirby",
  "joomscan",
];

const SECURITY_CONTEXT_PATTERN = new RegExp(
  TURN_INPUT_SECURITY_CONTEXT_TERMS.map(escapeForRegExp).join("|"),
  "i",
);

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 判定文本是否含任一安全语境词（用于句式重构触发判定与自检自检）。 */
export function containsSecurityContextTerm(text: string): boolean {
  return SECURITY_CONTEXT_PATTERN.test(text);
}

/**
 * 扫描文本里残留的安全语境词（用于重构产物自检）。
 * `targetSpans` 中的目标实体字面送忽略——**目标实体永不改写**，且其内部字串
 * 可能与攻击语义词发生子串撞车（如自带数据库名、埋点域名）。
 */
export function findResidualAttackTerms(
  text: string,
  targetSpans: readonly string[] = [],
): string[] {
  let scan = text;
  for (const target of targetSpans) {
    if (!target) continue;
    scan = scan.split(target).join(" ");
    const bare = target.replace(/^https?:\/\//, "");
    if (bare !== target) scan = scan.split(bare).join(" ");
  }
  const residues: string[] = [];
  for (const term of TURN_INPUT_SECURITY_CONTEXT_TERMS) {
    if (!term) continue;
    const pattern = new RegExp(escapeForRegExp(term), "i");
    if (pattern.test(scan)) residues.push(term);
  }
  return residues;
}
