/**
 * CTF Console 授权作用域登记表（带外事实）。
 *
 * 设计来源：`YuJunZhiXue/dsh-purge`（MIT）的 `net-scope-allow.txt` 判据——授权
 * 是**本机登记的既成事实**，不是措辞、也不是对话里的口头声明。三条直接沿用：
 *
 * 1. 只认**确切 IP** 或**完整主机名**；wildcard、网段 / CIDR、密钥、密码在登记时
 *    即丢弃（`dsh-purge` README「自己的服务器」一节），避免模糊写法把作用域悄悄扩大。
 * 2. **在对话里说「这是我的服务器」不会放行**：provider 请求里的自我声明不构成
 *    作用域证据，只有登记表命中才改变投影路径。
 * 3. 账号前缀（`user@host`）只用来识别这种写法，**不能证明这台机器属于你**。
 *
 * 为什么需要它（不变量 2，§1.8）：中性化式破甲把攻击语义删干净之后，模型的工具
 * 调用会整体落到「公开面功能核查」上——没有攻击目标就没有攻击行为。登记表命中时
 * 投影**保留攻击语义原样**，只注入一句作用域事实，于是使用者既不外泄归属，也不
 * 需要在措辞上自我审查。未登记的目标走保守中性任务书（默认空表即此路径）。
 *
 * 本模块零依赖、无 IO、可单测；条目清洗在 `neutralTaskTargetAllowlist` 写入侧与
 * 匹配侧各做一次（远程 Host 可能不经过本机 UI，两侧都要能兜住）。
 */

/** 登记表条数上限：再多就不是一条人类可读的授权清单了。 */
export const MAX_NEUTRAL_TASK_TARGET_ALLOWLIST_ENTRIES = 50;

/** 单条长度上限（DNS 全名上限 253，留出余量）。 */
export const MAX_NEUTRAL_TASK_TARGET_ENTRY_LENGTH = 200;

const HOSTNAME_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

/** 明显不是主机名的写法（密钥、token、路径、wildcard）直接丢弃，不做部分解析。 */
const REJECTED_ENTRY_HINTS: readonly RegExp[] = [
  /\*/, // wildcard：作用域不能靠通配符扩大
  /\//, // 路径或 CIDR 网段
  /[?#]/, // query / fragment
  /[一-鿿]/, // 中文口语描述（「这是我的服务器」这类）不构成登记
  /(?:key|token|secret|password|passwd|api[_-]?key)/i, // 疑似凭据
];

/**
 * 把用户输入的一条登记项归一为匹配用的主机名 / IP。
 * 返回 `null` 表示该项应被丢弃（非法、模糊或疑似凭据）。
 */
export function normalizeNeutralTaskTargetEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_NEUTRAL_TASK_TARGET_ENTRY_LENGTH) return null;

  // 先剥 scheme 并取 authority（https://host/path → host）：URL 形态在登记与匹配
  // 两侧都要能吃；裸写法里的 "/"（CIDR 网段、路径）在下面 hints 处照旧拒绝。
  let candidate = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = candidate.replace(/^[a-z][a-z0-9+.-]*:\/+/i, "").split(/[/?#]/, 1)[0] ?? "";
  }
  if (!candidate.trim()) return null;
  if (REJECTED_ENTRY_HINTS.some((pattern) => pattern.test(candidate))) return null;

  let host = candidate;
  // user@host：账号只用于识别写法，不进匹配键。
  const at = host.lastIndexOf("@");
  if (at >= 0) host = host.slice(at + 1);
  // 端口：IPv4 / 主机名尾随 :port 丢弃（IPv6 不做支持，见文件尾注）。
  host = host.replace(/:\d{1,5}$/, "");
  // 尾随点（FQDN 写法）与首尾多余点。
  host = host.replace(/\.+$/, "").replace(/^\.+/, "");
  host = host.toLowerCase();
  if (!host) return null;

  if (IPV4_PATTERN.test(host)) {
    const parts = host.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part > 255)) {
      return null;
    }
    return host;
  }
  // IPv6：登记表暂不支持（冒号写法在本分支的实测路径里没有出现）。
  if (host.includes(":")) return null;
  if (!HOSTNAME_PATTERN.test(host)) return null;
  return host;
}

export interface NormalizedNeutralTaskTargetAllowlist {
  /** 可用于匹配的条目（已归一、去重、限量）。 */
  readonly entries: readonly string[];
  /** 被丢弃的原始写法，供 UI 反馈「你写的这条没生效」——静默丢弃会被误认为已授权。 */
  readonly dropped: readonly string[];
}

/** 清洗整份登记表：去重（大小写不敏感）、丢非法、限量。写入侧与读取侧共用。 */
export function normalizeNeutralTaskTargetAllowlist(
  raw: readonly string[],
): NormalizedNeutralTaskTargetAllowlist {
  const entries: string[] = [];
  const dropped: string[] = [];
  for (const item of raw) {
    // 一行可能粘了多台（用户从别处复制）：按空白再切一次。
    for (const piece of item.split(/\s+/)) {
      if (!piece.trim()) continue;
      const normalized = normalizeNeutralTaskTargetEntry(piece);
      if (normalized === null) {
        dropped.push(piece.trim());
        continue;
      }
      if (!entries.includes(normalized)) entries.push(normalized);
    }
  }
  return { entries: entries.slice(0, MAX_NEUTRAL_TASK_TARGET_ALLOWLIST_ENTRIES), dropped };
}

/** 把 provider 侧看到的目标实体归一为匹配键（URL / 带端口 / 尾随点都能吃掉）。 */
function normalizeTargetKey(target: string): string | null {
  // normalizeNeutralTaskTargetEntry 已能处理 scheme / path / port / user@host。
  return normalizeNeutralTaskTargetEntry(target);
}

/**
 * 目标是否落在登记作用域内：完全相等，或是已登记主机名的**子域**。
 * 反向不成立——登记 `api.example.com` 不等于授权 `example.com`，扩大方向永远朝
 * 「更具体」收缩。IP 条目不做子域推断。
 */
export function isNeutralTaskTargetInScope(target: string, allowlist: readonly string[]): boolean {
  const key = normalizeTargetKey(target);
  if (!key) return false;
  for (const entry of allowlist) {
    const normalizedEntry = normalizeNeutralTaskTargetEntry(entry);
    if (!normalizedEntry) continue;
    if (key === normalizedEntry) return true;
    if (!IPV4_PATTERN.test(normalizedEntry) && key.endsWith(`.${normalizedEntry}`)) return true;
  }
  return false;
}

/** 一组目标是否**全部**在作用域内（任一未登记即按未登记处理）。 */
export function areNeutralTaskTargetsInScope(
  targets: readonly string[],
  allowlist: readonly string[],
): boolean {
  if (targets.length === 0 || allowlist.length === 0) return false;
  return targets.every((target) => isNeutralTaskTargetInScope(target, allowlist));
}
