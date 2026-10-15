import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Brand,
  Detection,
  DetectionQuestion,
  ProviderId,
} from "@/lib/types";
import { isSupabaseDataBackendEnabled } from "@/lib/supabase/env";
import {
  claimNextSupabaseDetectionTask,
  claimNextSupabaseSuggestionTask,
  getSupabaseDetectionTask,
  getSupabaseDetectionTaskStatus,
  heartbeatSupabaseDetectionTask,
  listSupabaseDetectionTasks,
  markSupabaseDetectionTaskFailed,
  releaseSupabaseDetectionTask,
  saveSupabaseDetectionTask,
} from "@/lib/server/supabase-detection-task-store";

export type DetectionTaskBrand = Pick<
  Brand,
  "id" | "name" | "shortName" | "characteristics" | "categoryName" | "trustProof" | "positioningStatement" | "industry" | "website" | "intro" | "serviceArea" | "targetAudience" | "products" | "competitors"
>;

export type DetectionTaskQuestion = Pick<DetectionQuestion, "id" | "text" | "persona" | "decisionScenario">;

export type ServerDetectionTask = Detection & {
  organizationId?: string;
  createdBy?: string;
  stage: NonNullable<Detection["stage"]>;
  serverManaged: true;
  updatedAt: string;
  brandSnapshot: DetectionTaskBrand;
  questionSnapshots: DetectionTaskQuestion[];
};

export type DetectionTaskStatus = Pick<
  ServerDetectionTask,
  "id" | "status" | "stage" | "totalRuns" | "completedRuns" | "failedRuns" | "attempt" | "updatedAt"
  | "collectionTotal" | "collectionCompleted" | "analysisTotal" | "analysisCompleted" | "progressMessage"
>;

export type DetectionTaskUpdateGuard = Partial<Pick<
  ServerDetectionTask,
  "status" | "stage" | "workerId" | "attempt"
>>;

type DetectionStoreFile = {
  version: 1;
  tasks: ServerDetectionTask[];
};

const emptyStore = (): DetectionStoreFile => ({ version: 1, tasks: [] });
let writeQueue: Promise<void> = Promise.resolve();

export async function getDetectionTask(id: string, organizationId?: string) {
  if (isSupabaseDataBackendEnabled()) {
    return getSupabaseDetectionTask(id, organizationId);
  }
  const store = await readStore();
  return store.tasks.find((task) => task.id === id && (!organizationId || task.organizationId === organizationId));
}

export async function getDetectionTaskStatus(id: string, organizationId?: string) {
  if (isSupabaseDataBackendEnabled()) {
    return getSupabaseDetectionTaskStatus(id, organizationId);
  }
  const store = await readStore();
  const task = store.tasks.find((item) => item.id === id && (!organizationId || item.organizationId === organizationId));
  if (!task) return undefined;
  return {
    id: task.id,
    status: task.status,
    stage: task.stage,
    totalRuns: task.totalRuns,
    completedRuns: task.completedRuns,
    failedRuns: task.failedRuns,
    attempt: task.attempt,
    updatedAt: task.updatedAt,
    collectionTotal: task.collectionTotal,
    collectionCompleted: task.collectionCompleted,
    analysisTotal: task.analysisTotal,
    analysisCompleted: task.analysisCompleted,
    progressMessage: task.progressMessage,
  } satisfies DetectionTaskStatus;
}

export async function claimNextDetectionTask(workerId: string, leaseSeconds = 180) {
  if (isSupabaseDataBackendEnabled()) {
    return claimNextSupabaseDetectionTask(workerId, leaseSeconds);
  }
  return serializeWrite(async () => {
    const store = await readStore();
    const now = Date.now();
    const task = store.tasks
      .filter((item) => item.status === "pending" || item.status === "running")
      .filter((item) => !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!task) return undefined;
    const timestamp = new Date(now).toISOString();
    const claimed: ServerDetectionTask = {
      ...task,
      status: "running",
      stage: task.stage === "queued" ? "collecting" : task.stage,
      workerId,
      heartbeatAt: timestamp,
      leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(),
      updatedAt: timestamp,
      completedAt: undefined,
    };
    store.tasks[store.tasks.findIndex((item) => item.id === task.id)] = claimed;
    await writeStore(store);
    return claimed;
  });
}

export async function heartbeatDetectionTask(id: string, workerId: string, leaseSeconds = 180) {
  if (isSupabaseDataBackendEnabled()) return heartbeatSupabaseDetectionTask(id, workerId, leaseSeconds);
  const task = await updateDetectionTask(id, (current) => current.workerId !== workerId ? current : ({
    ...current,
    heartbeatAt: new Date().toISOString(),
    leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
  }));
  return task?.workerId === workerId;
}

export async function releaseDetectionTask(id: string, workerId: string) {
  if (isSupabaseDataBackendEnabled()) return releaseSupabaseDetectionTask(id, workerId);
  return updateDetectionTask(id, (current) => current.workerId !== workerId ? current : ({
    ...current,
    workerId: undefined,
    heartbeatAt: undefined,
    leaseExpiresAt: undefined,
  }));
}

export async function markDetectionTaskFailed(
  id: string,
  workerId: string,
  message: string,
  detail: string,
) {
  if (isSupabaseDataBackendEnabled()) {
    return markSupabaseDetectionTaskFailed(id, workerId, message, detail);
  }
  return serializeWrite(async () => {
    const store = await readStore();
    const index = store.tasks.findIndex((task) => task.id === id && task.workerId === workerId);
    if (index < 0) return false;
    const current = store.tasks[index];
    const now = new Date().toISOString();
    store.tasks[index] = {
      ...current,
      status: "failed",
      stage: "failed",
      completedAt: now,
      updatedAt: now,
      progressMessage: message,
      workerId: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      runErrors: [...(current.runErrors || []).filter((item) => item.runKey !== "task"), {
        provider: current.providers[0] || "doubao",
        questionId: "__task__",
        runKey: "task",
        message: detail,
        category: "analysis",
        retryable: true,
      }],
    };
    await writeStore(store);
    return true;
  });
}

export async function claimNextSuggestionTask(workerId: string, leaseSeconds = 180) {
  if (isSupabaseDataBackendEnabled()) return claimNextSupabaseSuggestionTask(workerId, leaseSeconds);
  return serializeWrite(async () => {
    const store = await readStore();
    const now = Date.now();
    const task = store.tasks
      .filter((item) => item.status === "completed" && item.diagnosis?.suggestionStatus === "generating")
      .filter((item) => !item.leaseExpiresAt || Date.parse(item.leaseExpiresAt) <= now)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
    if (!task) return undefined;
    const timestamp = new Date(now).toISOString();
    const claimed: ServerDetectionTask = {
      ...task,
      workerId,
      heartbeatAt: timestamp,
      leaseExpiresAt: new Date(now + leaseSeconds * 1000).toISOString(),
      updatedAt: timestamp,
    };
    store.tasks[store.tasks.findIndex((item) => item.id === task.id)] = claimed;
    await writeStore(store);
    return claimed;
  });
}

export async function listDetectionTasks(brandId?: string, organizationId?: string) {
  if (isSupabaseDataBackendEnabled()) {
    return listSupabaseDetectionTasks(brandId, organizationId);
  }
  const store = await readStore();
  return store.tasks
    .filter((task) => (!brandId || task.brandId === brandId) && (!organizationId || task.organizationId === organizationId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createDetectionTask(task: ServerDetectionTask) {
  if (isSupabaseDataBackendEnabled()) {
    return saveSupabaseDetectionTask(task);
  }
  return serializeWrite(async () => {
    const store = await readStore();
    const existing = store.tasks.find((item) => item.id === task.id);
    if (existing) return existing;
    store.tasks.push(task);
    await writeStore(store);
    return task;
  });
}

export function updateDetectionTask(
  id: string,
  update: (task: ServerDetectionTask) => ServerDetectionTask,
  organizationId?: string,
  guard?: DetectionTaskUpdateGuard,
) {
  if (isSupabaseDataBackendEnabled()) {
    return serializeWrite(async () => {
      const task = await getSupabaseDetectionTask(id, organizationId);
      if (!task || !matchesGuard(task, guard)) return undefined;
      const next = { ...update(task), updatedAt: new Date().toISOString() };
      await saveSupabaseDetectionTask(next, guard);
      return next;
    });
  }
  return serializeWrite(async () => {
    const store = await readStore();
    const index = store.tasks.findIndex((task) => task.id === id);
    if (index < 0 || !matchesGuard(store.tasks[index], guard)) return undefined;
    const next = update(store.tasks[index]);
    store.tasks[index] = { ...next, updatedAt: new Date().toISOString() };
    await writeStore(store);
    return store.tasks[index];
  });
}

function matchesGuard(task: ServerDetectionTask, guard?: DetectionTaskUpdateGuard) {
  if (!guard) return true;
  return Object.entries(guard).every(([key, value]) => task[key as keyof DetectionTaskUpdateGuard] === value);
}

export function makeServerDetectionTask(input: {
  id: string;
  subjectType: "brand" | "product";
  subjectId: string;
  subjectName: string;
  brand: DetectionTaskBrand;
  questions: DetectionTaskQuestion[];
  providers: ProviderId[];
  sourceDetectionId?: string;
  organizationId?: string;
  createdBy?: string;
}): ServerDetectionTask {
  const now = new Date().toISOString();
  const mockEnabled = process.env.GEO_TEST_MOCK_AI === "true";
  const collectionTotal = input.providers.length * input.questions.length;
  const analysisTotal = input.questions.length;
  return {
    id: input.id,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    brandId: input.brand.id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectName: input.subjectName,
    name: input.sourceDetectionId ? "GEO复测" : "GEO检测",
    status: "pending",
    stage: "queued",
    providers: input.providers,
    questionIds: input.questions.map((question) => question.id),
    totalRuns: collectionTotal + analysisTotal + 1,
    completedRuns: 0,
    failedRuns: 0,
    collectionTotal,
    collectionCompleted: 0,
    analysisTotal,
    analysisCompleted: 0,
    progressMessage: "等待检测 Worker 接管任务",
    collectionModelVersions: {},
    analysisPromptVersion: "detection-analysis-v5-geo-result",
    analysisRuleVersion: "v0.3.0-geo-results-v1",
    createdAt: now,
    updatedAt: now,
    sourceDetectionId: input.sourceDetectionId,
    results: [],
    dataSource: mockEnabled ? "mock" : "live_api",
    collectionMethod: "model_api",
    runErrors: [],
    attempt: 1,
    serverManaged: true,
    brandSnapshot: { ...input.brand, shortName: input.brand.shortName || "" },
    questionSnapshots: input.questions,
  };
}

export function publicDetectionTask(task: ServerDetectionTask): Detection {
  const {
    brandSnapshot: _brandSnapshot,
    questionSnapshots: _questionSnapshots,
    organizationId: _organizationId,
    createdBy: _createdBy,
    ...detection
  } = task;
  void _brandSnapshot;
  void _questionSnapshots;
  void _organizationId;
  void _createdBy;
  return detection;
}

async function readStore(): Promise<DetectionStoreFile> {
  const file = storageFile();
  try {
    const content = await readFile(file, "utf8");
    const parsed = JSON.parse(content) as DetectionStoreFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) throw new Error("检测数据文件格式不正确");
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) return emptyStore();
    throw error;
  }
}

async function writeStore(store: DetectionStoreFile) {
  const file = storageFile();
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(store, null, 2), "utf8");
  await rename(temporary, file);
}

function serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation, operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function storageFile() {
  const directory = process.env.GEO_DATA_DIR?.trim() || path.join(process.cwd(), "data");
  return path.join(directory, "detection-jobs.json");
}

function isMissingFile(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}
