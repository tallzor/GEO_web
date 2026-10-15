"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
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
  const [reconnecting, setReconnecting] = useState(false);

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
        setReconnecting(false);
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
        if (!cancelled && consecutiveFailures >= 2) setReconnecting(true);
        schedule(Math.min(maxRetryIntervalMs, pollIntervalMs * 2 ** consecutiveFailures));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [detectionId, syncServerDetection]);

  if (!reconnecting) return null;
  return <div className="notice notice-warning" style={{ marginBottom: 16 }} role="status" aria-live="polite">
    <Info size={17} />连接暂时中断，检测任务仍在后台执行，正在重新连接。
  </div>;
}
