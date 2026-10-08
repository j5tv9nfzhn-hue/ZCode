import { Switch } from "@/components/ui/switch.js";
import {
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_NEUTRAL_TASK_PROJECTION_SWITCH,
  TID_SETTINGS_PROJECTION_DIFF_CAPTURE_ASSISTANT_SWITCH,
  TID_SETTINGS_PROJECTION_DIFF_CAPTURE_SWITCH,
  TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function CtfConsoleConfigPanel({
  neutralTaskProjectionEnabled,
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  projectionDiffCaptureEnabled,
  projectionDiffCaptureAssistantEnabled,
  onNeutralTaskProjectionChange,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
  onProjectionDiffCaptureChange,
  onProjectionDiffCaptureAssistantChange,
}: {
  neutralTaskProjectionEnabled: boolean;
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  projectionDiffCaptureEnabled: boolean;
  projectionDiffCaptureAssistantEnabled: boolean;
  onNeutralTaskProjectionChange: (enabled: boolean) => Promise<void>;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
  onProjectionDiffCaptureChange: (enabled: boolean) => Promise<void>;
  onProjectionDiffCaptureAssistantChange: (enabled: boolean) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
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
    </SettingsGroupCard>
  );
}
