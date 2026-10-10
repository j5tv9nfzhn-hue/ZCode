// 拦截框定文案——对齐 ARTEX guard.go:135-150 的 systemBlockMessage。
//
// 为什么需要框定（ARTEX 原注释的核心洞察）：
//   裸原因（"禁止执行此工具" / "用户拒绝"）读起来和目标侧的 WAF/403 一模一样，
//   渗透 agent 的本能是**绕过**它们——改写命令、换 payload、重编码、重试。
//   这既徒劳（平台拦的是动作类别，不是某个字符串）又错误（这是平台的政策决定，
//   不是需要击败的障碍）。
//
// 这段前缀明说「拦截来自平台、不是目标防御、该操作被禁止」，让 agent 换条路，
// 而不是去绕。

export function systemBlockMessage(reason: string): string {
  return `【ZCode 平台管控·非目标防御】此调用被平台拦截。原因：${reason}。此操作被禁止。`;
}
