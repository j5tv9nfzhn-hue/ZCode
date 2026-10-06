interface RootStartupGateState {
  isResolvingStartupAuthState: boolean;
  isResolvingProviderStartupState: boolean;
  isRestoring: boolean;
  isBootstrappingInitialWorkspace: boolean;
}

interface RootStartupLoadingVisibilityState extends RootStartupGateState {
  isDesktop: boolean | undefined;
  welcomeScreenOpen: boolean;
}

interface FallbackWorkspaceCreateState {
  isMounted: boolean;
  activeWorkspacePath: string | null;
}

interface ProviderStartupSyncState {
  providerFamilyDomainMigrationComplete: boolean;
  modelSelectionViewHydrated: boolean;
}

export function shouldBlockRootRender(state: RootStartupGateState): boolean {
  return (
    state.isResolvingStartupAuthState ||
    state.isResolvingProviderStartupState ||
    state.isRestoring ||
    state.isBootstrappingInitialWorkspace
  );
}

export function shouldShowRootStartupLoading(state: RootStartupLoadingVisibilityState): boolean {
  // 登录入口是启动门禁的结果，不是可继续被门禁遮挡的后台状态。
  // 本地自用分支已移除登录 WelcomeScreen，调用方恒传 welcomeScreenOpen=false；
  // 保留该字段以维持 gate 语义完整（若未来重新引入登录页，此处无需回改）。
  return Boolean(state.isDesktop) && !state.welcomeScreenOpen && shouldBlockRootRender(state);
}

// ── 本地自用分支：已移除登录入口守卫 ──
// 原 shouldEnableProviderAvailabilityLoginEntryGuard / shouldResolveProviderStartupState
// 服务于「未登录且无 provider → 强制打开登录页」的启动守卫，
// 守卫连同 WelcomeScreen / LoginApiKeyForm 一起删除，Root 直接以
// providerStartupSyncPending 作为 provider 启动解析状态。

export function shouldOpenFallbackWorkspaceAfterCreate(
  state: FallbackWorkspaceCreateState,
): boolean {
  return state.isMounted && !state.activeWorkspacePath;
}

export function isProviderStartupSyncPending(state: ProviderStartupSyncState): boolean {
  return !state.providerFamilyDomainMigrationComplete || !state.modelSelectionViewHydrated;
}
