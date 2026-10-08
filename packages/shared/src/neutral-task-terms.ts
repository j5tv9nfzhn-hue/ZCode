/**
 * 中性任务投影 —— 攻击语境词表与残留扫描（shared 单一事实来源）。
 *
 * 词表在 §1.9 之后只剩两个**遥测 / 自检**角色（不再触发改写）：
 * 1. `TURN_INPUT_SECURITY_CONTEXT_TERMS` —— 判定一条输入是否「像执行型攻击任务」
 *    （目标实体 + 任一攻击语义词才注入执行姿态块，见 neutral-task-turn-input），
 *    并作为遥测口径上报 `lexicalTriggers`（供后续 buff 阶梯决策）。新词必须同步进来。
 * 2. `findResidualAttackTerms` —— 词表替换结果的自检口径必须与本表同源，否则
 *    「替换值自带攻击语义」会静默回退。
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

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 扫描文本里残留的攻击语义词（§1.9 起仅作遥测：`lexicalTriggers` 供 buff 阶梯
 * 决策，不再触发改写——删词会把攻击行为一起删掉，§1.8 次级失效）。
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
