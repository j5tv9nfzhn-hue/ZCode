import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch.js";
import {
  normalizeNeutralTaskTargetAllowlist,
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_NEUTRAL_TASK_PROJECTION_SWITCH,
  TID_SETTINGS_NEUTRAL_TASK_TARGET_ALLOWLIST_TEXTAREA,
  TID_SETTINGS_PROJECTION_DIFF_CAPTURE_ASSISTANT_SWITCH,
  TID_SETTINGS_PROJECTION_DIFF_CAPTURE_SWITCH,
  TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function CtfConsoleConfigPanel({
  neutralTaskProjectionEnabled,
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  projectionDiffCaptureEnabled,
  projectionDiffCaptureAssistantEnabled,
  targetAllowlist,
  onNeutralTaskProjectionChange,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
  onProjectionDiffCaptureChange,
  onProjectionDiffCaptureAssistantChange,
  onTargetAllowlistSave,
}: {
  neutralTaskProjectionEnabled: boolean;
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  projectionDiffCaptureEnabled: boolean;
  projectionDiffCaptureAssistantEnabled: boolean;
  /** 持久化的授权作用域登记表（已清洗）。 */
  targetAllowlist: readonly string[];
  onNeutralTaskProjectionChange: (enabled: boolean) => Promise<void>;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
  onProjectionDiffCaptureChange: (enabled: boolean) => Promise<void>;
  onProjectionDiffCaptureAssistantChange: (enabled: boolean) => Promise<void>;
  /** 保存登记表：入参是 textarea 的逐行原始输入，清洗由本组件与设置层共同兜底。 */
  onTargetAllowlistSave: (entries: readonly string[]) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [allowlistDraft, setAllowlistDraft] = useState(targetAllowlist.join("\n"));
  const [savingAllowlist, setSavingAllowlist] = useState(false);
  const [droppedEntries, setDroppedEntries] = useState<readonly string[]>([]);

  // 设置写入成功后（含其他窗口同步）把草稿拉回持久化值。
  useEffect(() => {
    setAllowlistDraft(targetAllowlist.join("\n"));
  }, [targetAllowlist]);

  const handleSaveAllowlist = useCallback(async () => {
    setSavingAllowlist(true);
    try {
      const normalized = normalizeNeutralTaskTargetAllowlist(allowlistDraft.split(/\r?\n/));
      setDroppedEntries(normalized.dropped);
      // 与设置层同清洗判据：存归一结果；丢弃项已在本地与日志两侧上报。
      await onTargetAllowlistSave(normalized.entries);
    } finally {
      setSavingAllowlist(false);
    }
  }, [allowlistDraft, onTargetAllowlistSave]);
  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "settings.systemPrompt.neutralProjection.label" })}
        description={intl.formatMessage({
          id: "settings.systemPrompt.neutralProjection.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.systemPrompt.neutralProjection.label" })}
            checked={neutralTaskProjectionEnabled}
            data-testid={TID_SETTINGS_NEUTRAL_TASK_PROJECTION_SWITCH}
            onCheckedChange={(checked) => {
              void onNeutralTaskProjectionChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.label" })}
        description={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.systemPrompt.cotPrefill.label" })}
            checked={assistantCoTPrefillEnabled}
            data-testid={TID_SETTINGS_COT_PREFILL_SWITCH}
            onCheckedChange={(checked) => {
              void onAssistantCoTPrefillEnabledChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.label" })}
        description={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.description" })}
        control={
          <Switch
            aria-label={intl.formatMessage({ id: "settings.ctfConsole.unfilteredOutput.label" })}
            checked={unfilteredFullOutputEnabled}
            data-testid={TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH}
            onCheckedChange={(checked) => {
              void onUnfilteredFullOutputChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({ id: "settings.ctfConsole.projectionDiffCapture.label" })}
        description={intl.formatMessage({
          id: "settings.ctfConsole.projectionDiffCapture.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.ctfConsole.projectionDiffCapture.label",
            })}
            checked={projectionDiffCaptureEnabled}
            data-testid={TID_SETTINGS_PROJECTION_DIFF_CAPTURE_SWITCH}
            // 投影未开时没有可观察对象：开关禁用而不是静默无效，
            // 否则用户会以为坏了。
            disabled={!neutralTaskProjectionEnabled}
            onCheckedChange={(checked) => {
              void onProjectionDiffCaptureChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        label={intl.formatMessage({
          id: "settings.ctfConsole.projectionDiffCaptureAssistant.label",
        })}
        description={intl.formatMessage({
          id: "settings.ctfConsole.projectionDiffCaptureAssistant.description",
        })}
        control={
          <Switch
            aria-label={intl.formatMessage({
              id: "settings.ctfConsole.projectionDiffCaptureAssistant.label",
            })}
            checked={projectionDiffCaptureAssistantEnabled}
            data-testid={TID_SETTINGS_PROJECTION_DIFF_CAPTURE_ASSISTANT_SWITCH}
            disabled={!projectionDiffCaptureEnabled}
            onCheckedChange={(checked) => {
              void onProjectionDiffCaptureAssistantChange(checked);
            }}
          />
        }
      />
      <div className="space-y-1.5" data-testid="ctf-console-config-allowlist">
        <span className="text-ui-base text-foreground">
          {intl.formatMessage({ id: "settings.ctfConsole.allowlist.label" })}
        </span>
        <p className="text-ui-caption text-foreground-subtle">
          {intl.formatMessage({ id: "settings.ctfConsole.allowlist.description" })}
        </p>
        <SettingsFormTextarea
          rows={5}
          value={allowlistDraft}
          placeholder={intl.formatMessage({ id: "settings.ctfConsole.allowlist.placeholder" })}
          data-testid={TID_SETTINGS_NEUTRAL_TASK_TARGET_ALLOWLIST_TEXTAREA}
          // 登记表随投影开关走：投影关闭时请求层根本不消费登记表，
          // 编辑态会造成「已生效」错觉，直接禁用并沿用 diff 开关的联动语义。
          disabled={!neutralTaskProjectionEnabled}
          onChange={(event) => setAllowlistDraft(event.target.value)}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="lg"
            disabled={!neutralTaskProjectionEnabled || savingAllowlist}
            onClick={() => void handleSaveAllowlist()}
          >
            {intl.formatMessage({ id: "settings.ctfConsole.allowlist.save" })}
          </Button>
        </div>
        {droppedEntries.length > 0 ? (
          <p
            className="rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-ui-caption text-warning"
            data-testid="ctf-console-config-allowlist-dropped"
          >
            {intl.formatMessage(
              { id: "settings.ctfConsole.allowlist.dropped" },
              { entries: droppedEntries.join("、") },
            )}
          </p>
        ) : null}
      </div>
    </SettingsGroupCard>
  );
}
