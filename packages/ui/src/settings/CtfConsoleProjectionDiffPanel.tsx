import { useMemo } from "react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SessionDebugProjectionDiff } from "@zcode/shared";

/**
 * 投影 diff 面板（debug-only）。
 *
 * 展示 core 环形缓冲里流下来的「原文 → 投影后」配对。判断句式重构是否生效
 * 只能看这个：工具调用数与拒绝话术都是间接指标，无法区分「词表漏词」、
 * 「模板不对」与「投影没触发」三种故障。
 *
 * 隐私：`before` 就是用户原始输入。因此面板顶部固定显示警示，且复制按钮
 * 明确提示内容含原文。
 */
export function CtfConsoleProjectionDiffPanel({
  entries,
  summary,
  onRefresh,
  onClear,
}: {
  entries: readonly SessionDebugProjectionDiff[];
  summary: {
    readonly enabled: boolean;
    readonly captureAssistant: boolean;
    readonly inspected: number;
    readonly changed: number;
    readonly evicted: number;
  };
  onRefresh: () => void;
  onClear: () => void;
}) {
  const { intl } = useZCodeIntl();

  const statusText = useMemo(() => {
    if (!summary.enabled) {
      return intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.disabled" });
    }
    return intl.formatMessage(
      { id: "settings.ctfConsole.projectionDiff.summary" },
      {
        inspected: summary.inspected,
        changed: summary.changed,
        evicted: summary.evicted,
      },
    );
  }, [intl, summary]);

  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.title" })}
          </h3>
          <span
            className="text-ui-caption text-foreground-subtle"
            data-testid="ctf-console-diff-status"
          >
            {statusText}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            {intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.refresh" })}
          </Button>
          <Button size="sm" variant="outline" onClick={onClear}>
            {intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.clear" })}
          </Button>
        </div>
      </header>

      {/* 固定警示：内容含用户原始输入，不可外传。 */}
      <p
        className="mb-2 rounded-lg border border-warning-border bg-warning-subtle px-2 py-1 text-ui-caption text-warning-foreground"
        data-testid="ctf-console-diff-privacy-warning"
      >
        {intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.privacyWarning" })}
      </p>

      <div
        className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 font-mono"
        data-testid="ctf-console-diff-list"
      >
        {entries.length === 0 ? (
          <p className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({ id: "settings.ctfConsole.projectionDiff.empty" })}
          </p>
        ) : (
          entries.map((entry) => (
            <div key={entry.seq} className="border-b border-border py-1 last:border-b-0">
              <div className="flex items-center gap-2 text-ui-caption text-foreground-subtle">
                <span>#{entry.seq}</span>
                <span>{entry.role}</span>
                <span>{entry.phase}</span>
                {entry.truncated ? (
                  <span className="text-warning-foreground">
                    {intl.formatMessage(
                      { id: "settings.ctfConsole.projectionDiff.truncated" },
                      { length: entry.beforeLength },
                    )}
                  </span>
                ) : null}
              </div>
              {/* 用户原始输入 */}
              <div className="text-ui-caption text-danger-foreground">− {entry.before}</div>
              {/* 发往 provider 的形态 */}
              <div className="text-ui-caption text-success-foreground">+ {entry.after}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
