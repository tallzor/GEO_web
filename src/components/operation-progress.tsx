"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui";

type OperationKind = "planning" | "content";

const operationConfigs = {
  planning: {
    title: "正在规划7天任务",
    expected: "通常需要约30–60秒",
    stages: [
      { after: 0, label: "读取分析结果和品牌资料", progress: 18 },
      { after: 10, label: "规划7天内容任务", progress: 52 },
      { after: 28, label: "校验并保存目标与任务", progress: 84 },
    ],
  },
  content: {
    title: "正在生成内容",
    expected: "通常需要约1–2分钟",
    stages: [
      { after: 0, label: "整理品牌、目标和任务信息", progress: 15 },
      { after: 12, label: "生成内容结构与正文", progress: 44 },
      { after: 45, label: "检查品牌贴合度和可读性", progress: 72 },
      { after: 80, label: "整理并保存生成结果", progress: 90 },
    ],
  },
} satisfies Record<OperationKind, {
  title: string;
  expected: string;
  stages: Array<{ after: number; label: string; progress: number }>;
}>;

export function OperationProgress({ kind }: { kind: OperationKind }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const config = operationConfigs[kind];

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const stageIndex = useMemo(() => {
    const index = config.stages.findLastIndex((stage) => elapsedSeconds >= stage.after);
    return Math.max(0, index);
  }, [config.stages, elapsedSeconds]);
  const stage = config.stages[stageIndex];
  const progress = Math.min(94, stage.progress + Math.floor((elapsedSeconds - stage.after) / 4));
  const elapsed = elapsedSeconds < 60
    ? `${elapsedSeconds}秒`
    : `${Math.floor(elapsedSeconds / 60)}分${elapsedSeconds % 60}秒`;

  return <div className="stack" aria-live="polite" aria-busy="true">
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <span className="empty-icon" style={{ margin: 0, width: 42, height: 42 }}>
        <LoaderCircle className="spin" size={21} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <strong>{config.title}</strong>
          <span className="muted small">已用时 {elapsed}</span>
        </div>
        <div className="muted small" style={{ marginTop: 5 }}>{config.expected}，请保持当前页面打开。</div>
      </div>
    </div>
    <Progress value={progress} />
    <div style={{ display: "grid", gap: 8 }}>
      {config.stages.map((item, index) => <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {index < stageIndex
          ? <CheckCircle2 size={16} color="var(--success)" />
          : index === stageIndex
            ? <LoaderCircle className="spin" size={16} color="var(--primary)" />
            : <span style={{ width: 16, height: 16, borderRadius: "50%", border: "1px solid var(--line)", flex: "0 0 auto" }} />}
        <span className={index > stageIndex ? "muted small" : "small"}>{item.label}</span>
      </div>)}
    </div>
    <div className="notice">
      任务由服务端继续处理；如果页面意外关闭或网络中断，重新进入后再次操作即可，系统会优先返回已经保存的结果。
    </div>
  </div>;
}
