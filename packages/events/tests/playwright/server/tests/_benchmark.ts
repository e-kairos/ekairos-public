import { performance } from "node:perf_hooks";

function roundMs(value: number) {
  return Math.max(0, Math.round(value));
}

export function createStageTimer() {
  const startedAt = performance.now();
  const stageTimingsMs: Record<string, number> = {};
  let currentStage: string | undefined;

  return {
    async measure<T>(name: string, run: () => Promise<T> | T): Promise<T> {
      const previousStage = currentStage;
      currentStage = name;
      const stageStartedAt = performance.now();
      try {
        return await run();
      } finally {
        stageTimingsMs[name] = roundMs(performance.now() - stageStartedAt);
        currentStage = previousStage;
      }
    },
    add(name: string, value: number) {
      stageTimingsMs[name] = roundMs((stageTimingsMs[name] ?? 0) + value);
    },
    getCurrentStage() {
      return currentStage;
    },
    snapshot() {
      return {
        totalMs: roundMs(performance.now() - startedAt),
        stageTimingsMs: { ...stageTimingsMs },
      };
    },
  };
}
