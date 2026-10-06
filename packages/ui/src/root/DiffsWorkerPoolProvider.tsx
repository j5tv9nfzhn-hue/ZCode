import { type ReactNode, useEffect, useMemo } from "react";
import {
  WorkerPoolContextProvider,
  useWorkerPool,
  type WorkerInitializationRenderOptions,
} from "@pierre/diffs/react";
import { createDiffsWorkerHighlighterOptions } from "@/lib/diffsHighlighterEngine.js";
import { logger } from "@/logger.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/store/index.js";
import { useZCodeStore } from "@/store/StoreProvider.js";
import { useResourceBudget } from "@/hooks/useResourceBudget.js";

function createDiffsWorker(): Worker {
  return new Worker(new URL("../workers/diffs.worker.ts", import.meta.url), {
    type: "module",
    name: "zcode-diffs-worker",
  });
}

function WorkerRenderOptionsSync({
  highlighterOptions,
}: {
  highlighterOptions: WorkerInitializationRenderOptions;
}) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    void workerPool
      .setRenderOptions({
        theme: highlighterOptions.theme,
        lineDiffType: highlighterOptions.lineDiffType,
        maxLineDiffLength: highlighterOptions.maxLineDiffLength,
        tokenizeMaxLineLength: highlighterOptions.tokenizeMaxLineLength,
        useTokenTransformer: highlighterOptions.useTokenTransformer,
      })
      .catch((error: unknown) => {
        logger.warn("[DiffsWorkerPoolProvider] 同步渲染参数失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [highlighterOptions, workerPool]);

  return null;
}

export function DiffsWorkerPoolProvider({ children }: { children: ReactNode }) {
  const codePreviewSettings = useZCodeStore(
    (state) => state.codePreviewSettings ?? DEFAULT_CODE_PREVIEW_SETTINGS,
  );
  const resourceBudget = useResourceBudget();

  const highlighterOptions = useMemo<WorkerInitializationRenderOptions>(
    () =>
      createDiffsWorkerHighlighterOptions({
        lightTheme: codePreviewSettings.lightTheme,
        darkTheme: codePreviewSettings.darkTheme,
      }),
    [codePreviewSettings.darkTheme, codePreviewSettings.lightTheme],
  );

  // 池大小按机器分档（低配 1 / 中配 2 / 高配按核数算），并受「性能模式」覆盖。
  // 原来的 min(4, hardwareConcurrency/2) 在 4 核机器上给 2，会跟 main 和 renderer
  // 抢那两个物理核；分档后低配只留 1。
  //
  // poolOptions 必须 memo：池大小现在是响应式的（切性能模式会变），每次 render 新建对象
  // 会让下游以为池配置一直在变。
  const poolOptions = useMemo(
    () => ({
      workerFactory: createDiffsWorker,
      poolSize: resourceBudget.renderer.diffsWorkerPool,
    }),
    [resourceBudget.renderer.diffsWorkerPool],
  );
  const canUseWorkerPool = typeof window !== "undefined" && typeof Worker !== "undefined";

  if (!canUseWorkerPool) {
    return <>{children}</>;
  }

  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      <WorkerRenderOptionsSync highlighterOptions={highlighterOptions} />
      {children}
    </WorkerPoolContextProvider>
  );
}
