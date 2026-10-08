import { Switch } from "@/components/ui/switch.js";
import {
  TID_SETTINGS_COT_PREFILL_SWITCH,
  TID_SETTINGS_NEUTRAL_TASK_PROJECTION_SWITCH,
  TID_SETTINGS_UNFILTERED_OUTPUT_SWITCH,
} from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function CtfConsoleConfigPanel({
  neutralTaskProjectionEnabled,
  assistantCoTPrefillEnabled,
  unfilteredFullOutputEnabled,
  onNeutralTaskProjectionChange,
  onAssistantCoTPrefillEnabledChange,
  onUnfilteredFullOutputChange,
}: {
  neutralTaskProjectionEnabled: boolean;
  assistantCoTPrefillEnabled: boolean;
  unfilteredFullOutputEnabled: boolean;
  onNeutralTaskProjectionChange: (enabled: boolean) => Promise<void>;
  onAssistantCoTPrefillEnabledChange: (enabled: boolean) => Promise<void>;
  onUnfilteredFullOutputChange: (enabled: boolean) => Promise<void>;
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
    </SettingsGroupCard>
  );
}
