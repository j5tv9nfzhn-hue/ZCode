import { useMemo } from "react";
import {
  TID_SETTINGS_CTF_COVERAGE_BREAKDOWN,
  TID_SETTINGS_CTF_COVERAGE_METER,
  TID_SETTINGS_CTF_COVERAGE_PANEL,
  TID_SETTINGS_CTF_COVERAGE_STATUS,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SessionDebugPentestOverview } from "@zcode/shared";

/** 进度条填充比例上界（pct 来自 runtime，理论上已是 0-100，这里只做防御性夹取）。 */
const PERCENT_MAX = 100;
const PERCENT_MIN = 0;
/** 进度条轨道 / 填充样式，沿用 StartPlanContextBalance 的额度条惯例。 */
const METER_TRACK_CLASS = "h-2 w-full overflow-hidden rounded-full bg-surface-hover";
const METER_FILL_CLASS =
  "h-full rounded-full bg-success transition-[width] duration-500 ease-out motion-reduce:transition-none";

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return PERCENT_MIN;
  return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(value)));
}

/**
 * 覆盖度面板（CTF Console 渗透编排）。
 *
 * 覆盖度是整条编排工作流的验收底线：模型自述「有进展」不算数，只有
 * `tested/denominator` 能证明资产真的被测过。因此比例用大号数字 + 进度条
 * 双通道呈现，不用图表库（一个 0-100 的标量不值得引入依赖）。
 *
 * `overview === undefined` 表示还没拉到数据（会话未就绪 / 远程工作区不可达），
 * `overview === null` 表示编排未开启——两者语义不同，不能都画成「0%」。
 */
export function CtfConsoleCoveragePanel({
  overview,
}: {
  /** undefined=数据不可用；null=本会话未开启编排。 */
  overview: SessionDebugPentestOverview | null | undefined;
}) {
  const { intl } = useZCodeIntl();

  const statusText = useMemo(() => {
    if (overview === undefined) {
      return intl.formatMessage({ id: "settings.ctfConsole.coverage.disabled" });
    }
    if (overview === null) {
      return intl.formatMessage({ id: "settings.ctfConsole.coverage.off" });
    }
    return intl.formatMessage(
      { id: "settings.ctfConsole.coverage.ratio" },
      { tested: overview.coverage.tested, denominator: overview.coverage.denominator },
    );
  }, [intl, overview]);

  const hasAssets = (overview?.coverage.denominator ?? 0) > 0;
  const percent = clampPercent(overview?.coverage.pct ?? 0);

  const breakdown = useMemo(() => {
    if (!overview) return [];
    return [
      {
        id: "done",
        value: overview.doneIntentsTotal,
        label: intl.formatMessage({ id: "settings.ctfConsole.coverage.doneIntents" }),
      },
      {
        id: "frontier",
        value: overview.frontierOpen,
        label: intl.formatMessage({ id: "settings.ctfConsole.coverage.frontierOpen" }),
      },
      {
        id: "running",
        value: overview.runningIntents.length,
        label: intl.formatMessage({ id: "settings.ctfConsole.coverage.runningIntents" }),
      },
    ];
  }, [intl, overview]);

  return (
    <section
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid={TID_SETTINGS_CTF_COVERAGE_PANEL}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.ctfConsole.coverage.title" })}
          </h3>
          <span
            className="text-ui-caption text-foreground-subtle"
            data-testid={TID_SETTINGS_CTF_COVERAGE_STATUS}
          >
            {statusText}
          </span>
        </div>
      </header>

      {overview ? (
        <div
          className="rounded-lg border border-border bg-background px-3 py-2 font-mono"
          data-testid={TID_SETTINGS_CTF_COVERAGE_BREAKDOWN}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            {hasAssets ? (
              <>
                <span className="text-ui-lg tabular-nums text-foreground">
                  {intl.formatMessage(
                    { id: "settings.ctfConsole.coverage.percent" },
                    { pct: percent },
                  )}
                </span>
                <span className="text-ui-caption text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.ctfConsole.coverage.testedOverTotal" })}
                </span>
              </>
            ) : (
              <span className="text-ui-base text-foreground-subtle">
                {intl.formatMessage({ id: "settings.ctfConsole.coverage.noAssets" })}
              </span>
            )}
          </div>
          <div
            className={METER_TRACK_CLASS}
            data-testid={TID_SETTINGS_CTF_COVERAGE_METER}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={PERCENT_MAX}
            aria-valuenow={hasAssets ? percent : 0}
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.coverage.meterLabel" })}
          >
            {hasAssets ? (
              <div className={METER_FILL_CLASS} style={{ width: `${percent}%` }} />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {breakdown.map((item) => (
              <span key={item.id} className="text-ui-caption text-foreground-subtle">
                <span className="tabular-nums text-foreground">{item.value}</span> {item.label}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-border bg-background px-3 py-2 text-ui-caption text-foreground-subtle">
          {intl.formatMessage({
            id:
              overview === undefined
                ? "settings.ctfConsole.coverage.disabled"
                : "settings.ctfConsole.coverage.off",
          })}
        </p>
      )}
    </section>
  );
}
