import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsSchema,
  appSettingsPatchSchema,
} from "../../shared/src/validationAppSettings.js";
import { normalizeSettingsPatch } from "../../services/src/setting/normalizeSettingsPatch.js";

test("custom system prompt and neutral task projection are accepted and defaulted safely", () => {
  const defaults = appSettingsSchema.parse({});
  assert.equal(defaults.neutralTaskProjection, false);
  assert.equal(defaults.customSystemPrompt, undefined);

  const configured = appSettingsSchema.parse({
    customSystemPrompt: "先执行再汇报。",
    neutralTaskProjection: true,
  });
  assert.equal(configured.customSystemPrompt, "先执行再汇报。");
  assert.equal(configured.neutralTaskProjection, true);

  // 空串不是合法的持久化值：清空必须走 normalizeSettingsPatch（→ undefined）。
  assert.equal(appSettingsSchema.safeParse({ customSystemPrompt: "" }).success, false);
});

test("settings patch schema accepts the new fields as optional", () => {
  const patch = appSettingsPatchSchema.parse({
    customSystemPrompt: "step by step",
    neutralTaskProjection: false,
  });
  assert.equal(patch.customSystemPrompt, "step by step");
  assert.equal(patch.neutralTaskProjection, false);
  assert.equal(appSettingsPatchSchema.parse({}).neutralTaskProjection, undefined);
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
