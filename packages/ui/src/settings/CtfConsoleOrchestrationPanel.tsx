import { useMemo, useState } from "react";
import {
  TID_SETTINGS_CTF_ORCHESTRATION_FINDINGS,
  TID_SETTINGS_CTF_ORCHESTRATION_GROUPS,
  TID_SETTINGS_CTF_ORCHESTRATION_PANEL,
  TID_SETTINGS_CTF_ORCHESTRATION_PRIVACY,
  TID_SETTINGS_CTF_ORCHESTRATION_STATUS,
} from "@zcode/shared";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SessionDebugPentestOverview } from "@zcode/shared";

/**
 * 严重度 → 文字色 token。
 *
 * critical/high 是「必须立刻处理」的语义，用 destructive / warning；
 * medium/low 降级为前景弱化色，不再占用告警色（满屏黄色等于没有黄色）。
 * 只用无 `-foreground` 变体：那套是给实底徽标配反色文字的。
 */
const SEVERITY_TONE: Record<string, string> = {
  critical: "text-destructive",
  high: "text-warning",
  medium: "text-foreground-subtle",
  low: "text-foreground-subtlest",
};

const SEVERITY_FALLBACK_TONE = "text-foreground-subtle";
const GOAL_MET_STATE = "met";
const FACT_INFERRED_CONFIDENCE = "inferred";

function resolveSeverityTone(severity: string): string {
  return SEVERITY_TONE[severity.trim().toLowerCase()] ?? SEVERITY_FALLBACK_TONE;
}

/** 分组折叠区块：默认展开，标题行右侧带计数。 */
function OverviewGroup({
  title,
  count,
  testId,
  children,
}: {
  title: string;
  count: number;
  testId?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border-b border-border last:border-b-0"
    >
      <CollapsibleTrigger
        className="flex w-full items-center justify-between gap-2 py-1 text-left text-ui-caption text-foreground transition-colors hover:bg-hover"
        data-testid={testId}
      >
        <span>{title}</span>
        <span className="tabular-nums text-foreground-subtle">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GroupEmpty({ text }: { text: string }) {
  return <p className="py-1 text-ui-caption text-foreground-subtle">{text}</p>;
}

/**
 * 探索图 / 产物面板（CTF Console 渗透编排）。
 *
 * 只展示 runtime 摘要里的结论与 ID：目标、意图、漏洞、事实、用户提示。
 * 漏洞证据原文（命令输出、HTTP 响应）不进 session-debug 通道，因此本面板
 * 也不会凭空造出一段「详情」——隐私警示里明说了这一点。
 *
 * `overview === undefined`=数据不可用，`null`=编排未开启；两者都不渲染空编排。
 */
export function CtfConsoleOrchestrationPanel({
  overview,
}: {
  /** undefined=数据不可用；null=本会话未开启编排。 */
  overview: SessionDebugPentestOverview | null | undefined;
}) {
  const { intl } = useZCodeIntl();

  const statusText = useMemo(() => {
    if (overview === undefined) {
      return intl.formatMessage({ id: "settings.ctfConsole.orchestration.disabled" });
    }
    if (overview === null) {
      return intl.formatMessage({ id: "settings.ctfConsole.orchestration.off" });
    }
    return intl.formatMessage(
      { id: "settings.ctfConsole.orchestration.summary" },
      {
        goals: overview.goals.length,
        findings: overview.findingList.length,
        intents: overview.openIntents.length + overview.runningIntents.length,
      },
    );
  }, [intl, overview]);

  // hook 必须在 early return 之前：overview 从 undefined（轮询未就绪）变为有值时，
  // 若把 useMemo 放在 early return 之后，hook 调用数量会从 N 变 N+1，
  // React 直接抛 #310（Rendered more hooks than during the previous render）。
  // 派生态一律提到所有分支之前算，空值返回空数组即可——纯计算，无副作用。
  const { metGoals, openGoals, sortedOpenIntents } = useMemo(() => {
    if (!overview) {
      return { metGoals: [], openGoals: [], sortedOpenIntents: [] };
    }
    return {
      metGoals: overview.goals.filter((goal) => goal.state === GOAL_MET_STATE),
      openGoals: overview.goals.filter((goal) => goal.state !== GOAL_MET_STATE),
      // 排序只在快照变化时跑，不在每次 render 时重排。
      sortedOpenIntents: [...overview.openIntents].sort((a, b) => b.priority - a.priority),
    };
  }, [overview]);

  if (!overview) {
    return (
      <section
        className="rounded-xl border border-border bg-card px-4 py-3"
        data-testid={TID_SETTINGS_CTF_ORCHESTRATION_PANEL}
      >
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-ui-base text-foreground">
              {intl.formatMessage({ id: "settings.ctfConsole.orchestration.title" })}
            </h3>
            <span
              className="text-ui-caption text-foreground-subtle"
              data-testid={TID_SETTINGS_CTF_ORCHESTRATION_STATUS}
            >
              {statusText}
            </span>
          </div>
        </header>
        <div className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 font-mono">
          <p className="text-ui-caption text-foreground-subtle">
            {intl.formatMessage({
              id:
                overview === undefined
                  ? "settings.ctfConsole.orchestration.disabled"
                  : "settings.ctfConsole.orchestration.off",
            })}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="rounded-xl border border-border bg-card px-4 py-3"
      data-testid={TID_SETTINGS_CTF_ORCHESTRATION_PANEL}
    >
      <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-ui-base text-foreground">
            {intl.formatMessage({ id: "settings.ctfConsole.orchestration.title" })}
          </h3>
          <span
            className="text-ui-caption text-foreground-subtle"
            data-testid={TID_SETTINGS_CTF_ORCHESTRATION_STATUS}
          >
            {statusText}
          </span>
        </div>
      </header>

      <div
        className="max-h-72 min-h-24 overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 font-mono"
        data-testid={TID_SETTINGS_CTF_ORCHESTRATION_GROUPS}
      >
        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.goalsMet" })}
          count={metGoals.length}
        >
          {metGoals.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({ id: "settings.ctfConsole.orchestration.emptyGoals" })}
            />
          ) : (
            metGoals.map((goal) => (
              <div key={`met-${goal.id}`} className="text-ui-caption text-success">
                <span className="text-foreground-subtle">#{goal.id}</span> {goal.summary}
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.goalsOpen" })}
          count={openGoals.length}
        >
          {openGoals.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({ id: "settings.ctfConsole.orchestration.emptyGoals" })}
            />
          ) : (
            openGoals.map((goal) => (
              <div key={`open-${goal.id}`} className="text-ui-caption text-warning">
                <span className="text-foreground-subtle">#{goal.id}</span> {goal.summary}
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.runningIntents" })}
          count={overview.runningIntents.length}
        >
          {overview.runningIntents.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({
                id: "settings.ctfConsole.orchestration.emptyRunningIntents",
              })}
            />
          ) : (
            overview.runningIntents.map((intent) => (
              <div key={`run-${intent.id}`} className="text-ui-caption text-foreground">
                <span className="text-foreground-subtle">#{intent.id}</span> {intent.summary}
                {intent.owner ? (
                  <span className="text-foreground-subtle"> · {intent.owner}</span>
                ) : null}
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.openIntents" })}
          count={overview.openIntents.length}
        >
          {overview.openIntents.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({
                id: "settings.ctfConsole.orchestration.emptyOpenIntents",
              })}
            />
          ) : (
            sortedOpenIntents.map((intent) => (
              <div key={`intent-${intent.id}`} className="text-ui-caption text-foreground">
                <span className="text-foreground-subtle">
                  #{intent.id} p{intent.priority}
                </span>{" "}
                {intent.summary}
                {intent.assetIds.length > 0 ? (
                  <span className="text-foreground-subtle">
                    {" "}
                    ·{" "}
                    {intl.formatMessage(
                      { id: "settings.ctfConsole.orchestration.assetCount" },
                      { count: intent.assetIds.length },
                    )}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.findings" })}
          count={overview.findingList.length}
          testId={TID_SETTINGS_CTF_ORCHESTRATION_FINDINGS}
        >
          {overview.findingList.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({ id: "settings.ctfConsole.orchestration.emptyFindings" })}
            />
          ) : (
            overview.findingList.map((finding) => (
              <div key={`finding-${finding.id}`} className="text-ui-caption">
                <span className={resolveSeverityTone(finding.severity)}>[{finding.severity}]</span>{" "}
                <span className="text-foreground">{finding.vulnclass}</span>
                <div className="text-foreground-subtle">{finding.summary}</div>
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.recentFacts" })}
          count={overview.recentFacts.length}
        >
          {overview.recentFacts.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({ id: "settings.ctfConsole.orchestration.emptyFacts" })}
            />
          ) : (
            overview.recentFacts.map((fact) => (
              <div key={`fact-${fact.id}`} className="text-ui-caption text-foreground">
                <span className="text-foreground-subtle">#{fact.id}</span> {fact.summary}
                {fact.confidence === FACT_INFERRED_CONFIDENCE ? (
                  <span className="text-foreground-subtle">
                    {" "}
                    · {intl.formatMessage({ id: "settings.ctfConsole.orchestration.inferred" })}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </OverviewGroup>

        <OverviewGroup
          title={intl.formatMessage({ id: "settings.ctfConsole.orchestration.hints" })}
          count={overview.hints.length}
        >
          {overview.hints.length === 0 ? (
            <GroupEmpty
              text={intl.formatMessage({ id: "settings.ctfConsole.orchestration.emptyHints" })}
            />
          ) : (
            overview.hints.map((hint) => (
              <div key={`hint-${hint.id}`} className="text-ui-caption text-foreground">
                <span className="text-foreground-subtle">#{hint.id}</span> {hint.summary}
              </div>
            ))
          )}
        </OverviewGroup>

        {/* 固定警示：漏洞结论来自演练控制台。样式用 warning 12% 底 + text-warning，
            不能用 text-warning-foreground——那是给 bg-warning 实底徽标配的反色文字。 */}
        <p
          className="mt-2 rounded-lg border border-warning/60 bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] px-2 py-1 text-ui-caption text-warning"
          data-testid={TID_SETTINGS_CTF_ORCHESTRATION_PRIVACY}
        >
          {intl.formatMessage({ id: "settings.ctfConsole.orchestration.privacyWarning" })}
        </p>
      </div>
    </section>
  );
}
