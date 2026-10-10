import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
} from "../../shared/src/validationAppSettings.js";
import { normalizeSettingsPatch } from "../../services/src/setting/normalizeSettingsPatch.js";

test("custom system prompt is accepted and defaulted safely", () => {
  const defaults = appSettingsSchema.parse({});
  assert.equal(defaults.customSystemPrompt, undefined);

  const configured = appSettingsSchema.parse({
    customSystemPrompt: "先执行再汇报。",
  });
  assert.equal(configured.customSystemPrompt, "先执行再汇报。");

  // 空串不是合法的持久化值：清空必须走 normalizeSettingsPatch（→ undefined）。
  assert.equal(appSettingsSchema.safeParse({ customSystemPrompt: "" }).success, false);
});

test("settings patch schema accepts the custom system prompt as optional", () => {
  const patch = appSettingsPatchSchema.parse({
    customSystemPrompt: "step by step",
  });
  assert.equal(patch.customSystemPrompt, "step by step");
  assert.equal(appSettingsPatchSchema.parse({}).customSystemPrompt, undefined);
});

test("clearing the custom system prompt normalizes to undefined (restore default)", () => {
  assert.equal(normalizeSettingsPatch({ customSystemPrompt: "" }).customSystemPrompt, undefined);
  assert.equal(
    normalizeSettingsPatch({ customSystemPrompt: "   \n " }).customSystemPrompt,
    undefined,
  );
  assert.equal(
    normalizeSettingsPatch({ customSystemPrompt: "  persona  " }).customSystemPrompt,
    "persona",
  );
});
