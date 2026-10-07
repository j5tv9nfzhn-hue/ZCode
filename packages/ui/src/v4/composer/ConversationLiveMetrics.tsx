import type {
  ConversationRow,
  SessionPhase,
  SessionUsageState,
} from "@zcode/shared/zcode-protocol-v4";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { cn } from "@/components/lib/utils.js";
import { formatCompactTokenNumber } from "@/lib/tokenNumberFormat.js";
import { useConversationLiveMetrics } from "@/v4/composer/useConversationLiveMetrics.js";

/**
 * composer 输入卡下方的实时指标条：生成速度（token/s）、会话累计轮数与工具调用步数。
 *
 * 落位与 DeepSeek Harness 生态的 live-stats 插件一致——贴在输入框正下方，跟随 sticky dock，
 * 不进入输入壳（输入壳的 `rounded-2xl` 是 DESIGN.md 的批准例外，不应再塞入新的一层）。
 *
 * 数据全部来自 v4 投影快照，因此与 desktop-continuous / mobile replayable 两条投递语义
 * 共享同一份事实，不需要为移动端另开数据源。
 */
export function ConversationLiveMetrics({
  usage,
  phase,
  rows,
  className,
}: {
  usage: SessionUsageState | null | undefined;
  phase: SessionPhase | null | undefined;
  rows: readonly ConversationRow[] | undefined;
  className?: string;
}) {
  const { intl, locale } = useZCodeIntl();
  const metrics = useConversationLiveMetrics({ usage, phase, rows });

  // 空闲且没有任何累计计数时不占位：草稿会话与刚打开的空会话不应出现一条全零的横条。
  const hasCounters = (metrics.turns ?? 0) > 0 || (metrics.steps ?? 0) > 0;
  if (!metrics.running && !hasCounters) return null;

  // 完成态显示上一次生成的收尾速率（hook 冻结保持），不再退回「—」；
  // 真正没有速率可读（首答没攒够样本 / 从未生成过）才显示占位符。
  const displayRate = metrics.tokensPerSecond ?? (metrics.running ? null : metrics.lastRate);
  const rateLabel =
    displayRate === null
      ? "—"
      : `${formatCompactTokenNumber(locale, displayRate, { maximumFractionDigits: 1 })}`;

  return (
    <div
      data-testid="conversation-live-metrics"
      data-tps={displayRate ?? ""}
      data-turns={metrics.turns ?? ""}
      data-steps={metrics.steps ?? ""}
      // 轮/步是「本会话发生过多少工作」的累计量：回退（rewind）不会让它们减少，
      // 因为投影层拿不到被删行的类型分布。措辞上明确口径，避免被读成当前对话长度。
      title={intl.formatMessage({ id: "chat.liveMetrics.cumulativeHint" })}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-1.5",
        "text-ui-xs text-foreground-subtlest",
        className,
      )}
    >
      <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
        <span className="font-mono tabular-nums">{rateLabel}</span>
        <span>{intl.formatMessage({ id: "chat.liveMetrics.tokensPerSecond" })}</span>
      </span>
      {metrics.turns !== null ? (
        <span className="whitespace-nowrap">
          {intl.formatMessage({ id: "chat.liveMetrics.turns" }, { count: metrics.turns })}
        </span>
      ) : null}
      {metrics.steps !== null ? (
        <span className="whitespace-nowrap">
          {intl.formatMessage({ id: "chat.liveMetrics.steps" }, { count: metrics.steps })}
        </span>
      ) : null}
    </div>
  );
}
