import type { StateCreator } from "zustand";
import type { SeedData } from "@/lib/seed";
import { createBrandSlice } from "@/lib/store/brand-slice";
import { createCognitionSlice } from "@/lib/store/cognition-slice";
import type { AppStore, StoreDependencies } from "@/lib/store/contracts";
import { createDetectionSlice } from "@/lib/store/detection-slice";
import { createOptimizationSlice } from "@/lib/store/optimization-slice";
import { createWorkspaceSlice } from "@/lib/store/workspace-slice";

/** 组合领域 slice；测试与浏览器 Store 共用同一 interface。 */
export function createAppStoreState(
  initial: SeedData,
  dependencies: StoreDependencies,
): StateCreator<AppStore> {
  const workspaceSlice = createWorkspaceSlice(initial, dependencies);
  const brandSlice = createBrandSlice(initial, dependencies);
  const detectionSlice = createDetectionSlice(initial, dependencies);
  const optimizationSlice = createOptimizationSlice(initial, dependencies);
  const cognitionSlice = createCognitionSlice(dependencies);
  return (set, get, store) => ({
    ...workspaceSlice(set, get, store),
    ...brandSlice(set, get, store),
    ...detectionSlice(set, get, store),
    ...optimizationSlice(set, get, store),
    ...cognitionSlice(set, get, store),
  });
}
