// ============================================================
// Context Builder exports
// ============================================================

export * from "./types.js";
export * from "./builder.js";
export * from "./utils.js";

// Section builders (for testing)
export { buildCliPrefixSection } from "./sections/cli-prefix.js";
export { buildIdentitySection } from "./sections/identity.js";
export { buildMainAgentOrchestrationIdentitySection } from "./sections/main-agent-orchestration.js";
export { buildWorkflowActorIdentitySection } from "./sections/workflow-actor.js";
export { buildEnvInfoSection, buildGitSystemContextSection } from "./sections/env-info.js";
export { buildSkillsSection } from "./sections/skills.js";
export { buildCurrentDateSection } from "./sections/current-date.js";
export { buildMemorySection } from "./sections/memory.js";
export { buildDesktopContextSection } from "./sections/desktop.js";
