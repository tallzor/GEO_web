"use client";

import { FormEvent, useState } from "react";
import { Badge, Button, Card, Field, PageHeader } from "@/components/ui";

type SampleResult = {
  requestId?: string;
  model: string;
  answer: string;
  citations: { title: string; url: string }[];
  searchQueries: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  latencyMs: number;
};

const defaultQuestion = "深圳南山区适合健身新手的健身房有哪些？请说明推荐理由和信息来源。";

export function DoubaoDebugView() {
  const [question, setQuestion] = useState(defaultQuestion);
  const [enableWebSearch, setEnableWebSearch] = useState(true);
  const [result, setResult] = useState<SampleResult>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(undefined);

    try {
      const response = await fetch("/api/dev/doubao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, enableWebSearch }),
      });
      const payload = await response.json() as SampleResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "调用失败");
      setResult(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "调用失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="豆包接口验证"
        description="仅本地开发环境可用，用于确认模型回答、联网搜索和引用返回结构。"
        actions={<Badge tone="warning">不会出现在生产环境</Badge>}
      />

      <div className="stack">
        <Card title="发起一次真实调用" description="API Key仅由Next.js服务端读取，浏览器无法获得。">
          <form className="stack" onSubmit={submit}>
            <Field label="检测问题" required hint="本阶段先验证单次调用，确认稳定后再增加10次采样。">
              <textarea
                className="textarea"
                rows={5}
                maxLength={500}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={enableWebSearch}
                onChange={(event) => setEnableWebSearch(event.target.checked)}
              />
              开启联网搜索
            </label>
            <div>
              <Button type="submit" variant="primary" disabled={loading || question.trim().length < 2}>
                {loading ? "豆包正在回答…" : "开始验证"}
              </Button>
            </div>
          </form>
        </Card>

        {error && (
          <Card title="调用失败">
            <p style={{ margin: 0, color: "var(--danger)", lineHeight: 1.7 }}>{error}</p>
          </Card>
        )}

        {result && (
          <>
            <Card
              title="模型回答"
              description={`${result.model} · ${(result.latencyMs / 1000).toFixed(1)}秒${result.requestId ? ` · ${result.requestId}` : ""}`}
              action={<Badge tone="success">真实API结果</Badge>}
            >
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.85 }}>{result.answer}</div>
            </Card>

            <div className="grid grid-2">
              <Card title={`引用来源（${result.citations.length}）`}>
                {result.citations.length ? (
                  <div className="stack">
                    {result.citations.map((citation) => (
                      <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" style={{ color: "var(--primary)" }}>
                        {citation.title}
                      </a>
                    ))}
                  </div>
                ) : <span style={{ color: "var(--text-muted)" }}>本次回答没有返回可识别引用</span>}
              </Card>

              <Card title="调用信息">
                <div className="stack">
                  <div>搜索词：{result.searchQueries.join("；") || "未返回"}</div>
                  <div>输入Token：{result.usage?.inputTokens ?? "未返回"}</div>
                  <div>输出Token：{result.usage?.outputTokens ?? "未返回"}</div>
                  <div>总Token：{result.usage?.totalTokens ?? "未返回"}</div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
