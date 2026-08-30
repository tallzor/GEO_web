"use client";

import { useEffect } from "react";
import {
  ensureServerDetectionTask,
  readDetectionResponse,
  readDetectionStatusResponse,
} from "@/lib/detection-client";
import { useAppStore } from "@/lib/store";

const pollIntervalMs = 3_000;
const maxRetryIntervalMs = 15_000;

export function LiveDetectionRunner({ detectionId }: { detectionId: string }) {
  const syncServerDetection = useAppStore((state) => state.syncServerDetection);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let consecutiveFailures = 0;

    const schedule = (delay = pollIntervalMs) => {
      if (!cancelled) timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/detections/${encodeURIComponent(detectionId)}?view=status`, {
          cache: "no-store",
        });
        if (response.status === 404) {
          await ensureServerDetectionTask(detectionId);
          schedule();
          return;
        }
        const status = await readDetectionStatusResponse(response);
        if (cancelled) return;
        consecutiveFailures = 0;
        if (status.status === "pending" || status.status === "running") {
          const current = useAppStore.getState().detections.find((item) => item.id === detectionId);
          if (current) syncServerDetection({ ...current, ...status });
          schedule();
          return;
        }

        const fullResponse = await fetch(`/api/detections/${encodeURIComponent(detectionId)}`, {
          cache: "no-store",
        });
        const detection = await readDetectionResponse(fullResponse);
        if (!cancelled) syncServerDetection(detection);
      } catch {
        consecutiveFailures += 1;
        schedule(Math.min(maxRetryIntervalMs, pollIntervalMs * 2 ** consecutiveFailures));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [detectionId, syncServerDetection]);

  return null;
}
