"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, PageHeader, Progress } from "@/components/ui";
import { useAppStore } from "@/lib/store";
import type { DetectionQuestion } from "@/lib/types";

export function QuestionGenerationView() {
  const search = useSearchParams();
  const requestedBrandId = search.get("brand");
  const brand = useAppStore((state) =>
    state.brands.find((item) => item.id === (requestedBrandId || state.currentBrandId)),
  );
  const mergePersistedQuestions = useAppStore((state) => state.mergePersistedQuestions);
  const startedRef = useRef(false);
  const [generating, setGenerating] = useState(true);
  const [error, setError] = useState("");
  const [questionIds, setQuestionIds] = useState<string[]>([]);

  const generate = useCallback(async () => {
    if (!brand) return;
    setGenerating(true);
    setError("");
    setQuestionIds([]);

    try {
      const response = await fetch("/api/questions/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: brand.id,
          brandName: brand.name,
          characteristics: brand.characteristics,
          categoryName: brand.categoryName,
          trustProof: brand.trustProof,
          positioningStatement: brand.positioningStatement,
          industry: brand.industry,
          serviceMarket: brand.serviceArea || brand.city,
          targetAudience: brand.targetAudience || "",
          products: brand.products.map((item) => ({
            name: item.name,
            description: item.description,
          })),
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(readError(payload));
      if (!isRecord(payload) || !Array.isArray(payload.questions) || typeof payload.generatedAt !== "string") {
        throw new Error("基座模型返回的问题格式不正确");
      }
      const questions = payload.questions.filter(isDetectionQuestion);
      if (!questions.length) throw new Error("基座模型没有返回可用问题");
      setQuestionIds(mergePersistedQuestions(brand.id, questions, payload.generatedAt));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "问题生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }, [brand, mergePersistedQuestions]);

  useEffect(() => {
    if (!brand || startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [brand, generate]);

  if (!brand) {
    return <>
      <PageHeader title="生成检测问题" description="根据品牌资料生成真实用户可能提出的问题。" />
      <Card><EmptyState title="未找到品牌" description="请先创建品牌档案。" action={<Link className="btn btn-primary" href="/brands/new">新建品牌</Link>} /></Card>
    </>;
  }

  const generatedQuestions = questionIds.flatMap((id) => {
    const question = brand.questions.find((item) => item.id === id)
      || useAppStore.getState().brands.find((item) => item.id === brand.id)?.questions.find((item) => item.id === id);
    return question ? [question] : [];
  });
  return <>
    <PageHeader title="AI生成检测问题" description={`系统正在根据“${brand.name}”的品牌资料生成真实用户可能提出的问题。`} />
    <Card title="品牌信息摘要" description="资料越完整，问题越贴合实际业务。">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Badge tone="primary">{brand.name}</Badge>
        <Badge>{brand.industry || "行业未填写"}</Badge>
        <Badge>{brand.serviceArea || brand.city || "服务市场未填写"}</Badge>
        <Badge>{brand.targetAudience || "目标人群未填写"}</Badge>
      </div>
    </Card>

    <div className="section-gap">
      {generating ? <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span className="empty-icon" style={{ margin: 0, width: 54, height: 54 }}><LoaderCircle className="spin" size={26} /></span>
          <div style={{ flex: 1 }}><strong>基座模型正在理解品牌信息并生成问题</strong><div className="muted small" style={{ margin: "8px 0" }}>最多生成15条问题，请保持当前页面打开。</div><Progress value={65} /></div>
        </div>
      </Card> : error ? <Card><EmptyState title="问题生成失败" description={error} action={<Button variant="primary" onClick={() => void generate()}><RefreshCw size={16} />重新生成</Button>} /></Card> : <Card
        title={`已生成 ${generatedQuestions.length} 条问题`}
        description="所有问题均已自动保存到问题库。"
      >
        <div className="stack">
          {generatedQuestions.map((question, index) => <div key={question.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: 14, border: "1px solid var(--line)", borderRadius: 9, background: "#fff" }}>
            <span className="muted small" style={{ width: 24 }}>{index + 1}</span>
            <strong style={{ lineHeight: 1.55 }}>{question.text}</strong>
          </div>)}
        </div>
        <div className="form-actions" style={{ marginTop: 18 }}>
          <Button onClick={() => void generate()}><RefreshCw size={16} />重新生成</Button>
          <Link className="btn" href="/geo/questions"><ArrowLeft size={16} />返回</Link>
        </div>
      </Card>}
    </div>
    <style jsx global>{`.spin{animation:geo-spin 1s linear infinite}@keyframes geo-spin{to{transform:rotate(360deg)}}`}</style>
  </>;
}

function readError(payload: unknown) {
  return isRecord(payload) && typeof payload.error === "string"
    ? payload.error
    : "问题生成失败，请重试";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDetectionQuestion(value: unknown): value is DetectionQuestion {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.text === "string"
    && (value.source === "industry" || value.source === "generated" || value.source === "custom")
    && typeof value.category === "string"
    && typeof value.enabled === "boolean"
    && typeof value.updatedAt === "string";
}
