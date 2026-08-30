"use client";

import Link from "next/link";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileQuestion,
  Package,
  Pencil,
  Plus,
  Target,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, EmptyState, Progress } from "@/components/ui";
import {
  detectionAnalysisSummary,
  type AnalysisDimensionScores,
} from "@/lib/detection-metrics";
import { brandCompleteness } from "@/lib/engine";
import { activeCycle, currentBrand, useAppStore } from "@/lib/store";
import { OptimizationCycle, OptimizationTask } from "@/lib/types";

const dimensions: { key: keyof AnalysisDimensionScores; label: string; tone: string }[] = [
  { key: "visibility", label: "能见", tone: "blue" },
  { key: "ranking", label: "排名", tone: "purple" },
  { key: "reputation", label: "口碑", tone: "green" },
  { key: "sentiment", label: "情感", tone: "orange" },
];

const weekDayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function WorkbenchView() {
  const brand = useAppStore(currentBrand);
  const rawDetections = useAppStore((state) => state.detections);
  const cycle = useAppStore(activeCycle);
  const detections = useMemo(
    () => rawDetections
      .filter((item) => item.brandId === brand?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [rawDetections, brand?.id],
  );

  if (!brand) {
    return (
      <Card className="workbench-empty-card">
        <EmptyState
          title="还没有品牌"
          description="创建品牌后，这里会汇总品牌档案、诊断分析和7天优化任务。"
          action={<Link className="btn btn-primary" href="/brands/new"><Plus size={16} />新建品牌</Link>}
        />
      </Card>
    );
  }

  const latest = detections.find((item) => item.status === "completed" && item.diagnosis);
  const latestSummary = latest ? detectionAnalysisSummary(latest, brand) : undefined;
  const completeness = brandCompleteness(brand);

  return (
    <>
      <BrandSummary
        name={brand.name}
        industry={brand.industry}
        serviceArea={brand.serviceArea}
        productCount={brand.products.length}
        completeness={completeness}
      />

      <div className="workbench-main-grid section-gap">
        <div className="stack">
          {latest?.diagnosis ? (
            <Card
              title="最近一次检测分析摘要"
              description={new Date(latest.completedAt || latest.createdAt).toLocaleString("zh-CN")}
              action={<Link className="btn btn-sm" href={`/analysis/visibility?detection=${latest.id}`}>查看完整分析 <ChevronRight size={14} /></Link>}
            >
              <div className="workbench-diagnosis-overview">
                <div className="workbench-diagnosis-grid">
                  {dimensions.map((item) => (
                    <div className={`workbench-diagnosis-metric tone-${item.tone}`} key={item.key}>
                      <div className="muted small">{item.label}</div>
                      <strong>{latestSummary!.display[item.key]}</strong>
                    </div>
                  ))}
                </div>
                <DiagnosisRadar scores={latestSummary!.scores} availability={latestSummary!.availability} />
              </div>
              <div className="workbench-diagnosis-summary">
                <BarChart3 size={18} />
                <div>
                  <strong>分析结论</strong>
                  <p>{latest.diagnosis.summary}</p>
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <EmptyState
                title="还没有品牌检测"
                description="完成首次检测后，这里会展示品牌在AI平台中的表现。"
                action={<Link className="btn btn-primary" href="/geo/new">开始首次检测</Link>}
                icon={<BarChart3 size={24} />}
              />
            </Card>
          )}

          {cycle ? (
            <GoalProgressCard cycle={cycle} />
          ) : latest?.diagnosis ? (
            <Card>
              <EmptyState
                title="尚未确认优化目标"
                description="从诊断报告的建议中选择一项，系统将生成7天优化任务。"
                action={<Link className="btn btn-primary" href={`/analysis/visibility?detection=${latest.id}`}>选择优化目标</Link>}
                icon={<Target size={24} />}
              />
            </Card>
          ) : null}
        </div>

        <WeeklyTaskCard key={`${cycle?.id || "empty"}-${cycle?.currentDay || 1}`} cycle={cycle} />
      </div>
    </>
  );
}

function BrandSummary({
  name,
  industry,
  serviceArea,
  productCount,
  completeness,
}: {
  name: string;
  industry: string;
  serviceArea: string;
  productCount: number;
  completeness: number;
}) {
  return (
    <section className="card workbench-brand-card">
      <div className="workbench-brand-main">
        <div className="workbench-brand-identity">
          <span className="brand-mark workbench-brand-mark">{name.slice(0, 1)}</span>
          <div>
            <h1>{name}</h1>
            <div className="workbench-brand-tags">
              <span>{industry || "行业待完善"}</span>
              {serviceArea && <span>{serviceArea}</span>}
              <span className="workbench-product-tag"><Package size={13} />产品数量 {productCount}</span>
              <small aria-label={`档案完整度 ${completeness}%`}>档案完整度 {completeness}%</small>
            </div>
          </div>
        </div>

        <div className="workbench-brand-actions">
          <Link className="btn" href="/brand/basic"><Pencil size={15} />编辑品牌信息</Link>
          <Link className="btn btn-primary" href="/geo/questions"><FileQuestion size={16} />管理问题库</Link>
        </div>
      </div>
    </section>
  );
}

function GoalProgressCard({ cycle }: { cycle: OptimizationCycle }) {
  const completed = cycle.tasks.filter((task) => task.status === "completed").length;
  const inProgress = cycle.tasks.filter((task) => task.status === "in_progress").length;
  const pending = cycle.tasks.filter((task) => task.status === "pending").length;
  const percent = Math.round((completed / cycle.tasks.length) * 100);

  return (
    <Card
      title="当前优化目标"
      action={<Link className="btn btn-sm" href="/tasks">查看全部任务</Link>}
    >
      <div className="workbench-goal-heading">
        <span className="workbench-goal-icon"><Target size={20} /></span>
        <div className="workbench-goal-title-line">
          <h3>{cycle.target}</h3>
          <Badge tone="primary">进行中</Badge>
        </div>
        <strong>第 {cycle.currentDay}/7 天</strong>
      </div>
      <div className="workbench-progress-label">
        <span>{completed}/{cycle.tasks.length} 项已完成</span>
        <strong>{percent}%</strong>
      </div>
      <Progress value={percent} />
      <div className="workbench-task-stats">
        <MiniStat value={completed} label="已完成" tone="success" />
        <MiniStat value={inProgress} label="进行中" tone="primary" />
        <MiniStat value={pending} label="待完成" tone="muted" />
      </div>
    </Card>
  );
}

function WeeklyTaskCard({ cycle }: { cycle?: OptimizationCycle }) {
  const [selectedDay, setSelectedDay] = useState(cycle?.currentDay || 1);
  const selectedTasks = cycle?.tasks.filter((task) => task.day === selectedDay) || [];
  const selectedDate = cycle ? getCycleDate(cycle.startDate, selectedDay) : null;
  const isCurrentDay = selectedDay === cycle?.currentDay;

  return (
    <Card
      title="今日任务"
      description={cycle ? `${formatFullDate(selectedDate!)} · 第 ${selectedDay}/7 天` : "暂无活动任务"}
      action={cycle ? <Link className="btn btn-sm" href="/tasks">任务中心</Link> : undefined}
      className="workbench-week-card"
    >
      {cycle ? (
        <>
          <div className="workbench-week-calendar" role="group" aria-label="7天任务日期">
            {Array.from({ length: 7 }, (_, index) => {
              const day = index + 1;
              const date = getCycleDate(cycle.startDate, day);
              const phase = day < cycle.currentDay ? "past" : day === cycle.currentDay ? "current" : "future";
              const dayTasks = cycle.tasks.filter((task) => task.day === day);
              const complete = dayTasks.length > 0 && dayTasks.every((task) => task.status === "completed");
              return (
                <button
                  aria-label={`第${day}天 ${formatMonthDay(date)}`}
                  aria-pressed={selectedDay === day}
                  className={`workbench-day ${phase} ${selectedDay === day ? "selected" : ""}`}
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  type="button"
                >
                  <span>{weekDayNames[date.getDay()]}</span>
                  <strong>{date.getDate()}</strong>
                  {complete ? <CheckCircle2 size={13} /> : <i />}
                </button>
              );
            })}
          </div>

          <div className="workbench-selected-day">
            <div>
              <strong>{isCurrentDay ? "今天要做" : `${formatMonthDay(selectedDate!)}的任务`}</strong>
              <span>{selectedTasks.length} 项任务</span>
            </div>
            {isCurrentDay && <Badge tone="primary">今日</Badge>}
          </div>

          <div className="workbench-day-tasks">
            {selectedTasks.map((task) => <TaskItem key={task.id} task={task} />)}
            {!selectedTasks.length && (
              <div className="workbench-task-empty">
                <CalendarDays size={21} />
                <span>当天没有安排任务</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="workbench-task-empty">
          <CalendarDays size={24} />
          <span>选择优化目标后，这里会生成7天任务安排。</span>
        </div>
      )}
    </Card>
  );
}

function TaskItem({ task }: { task: OptimizationTask }) {
  const status = task.status === "completed" ? "已完成" : task.status === "in_progress" ? "进行中" : "待开始";
  const tone = task.status === "completed" ? "success" : task.status === "in_progress" ? "primary" : "default";
  return (
    <Link className="workbench-task-item" href="/tasks">
      <span className={`workbench-task-icon status-${task.status}`}>
        {task.status === "completed" ? <CheckCircle2 size={18} /> : <Clock3 size={18} />}
      </span>
      <div>
        <strong>{task.title}</strong>
        <p>{task.description}</p>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <ChevronRight size={17} />
    </Link>
  );
}

function MiniStat({ value, label, tone }: { value: number; label: string; tone: "success" | "primary" | "muted" }) {
  return (
    <div className={`workbench-mini-stat tone-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function DiagnosisRadar({
  scores,
  availability,
}: {
  scores: AnalysisDimensionScores;
  availability?: Partial<Record<keyof AnalysisDimensionScores, boolean>>;
}) {
  const center = { x: 130, y: 104 };
  const vertices = [
    { x: 130, y: 30 },
    { x: 204, y: 104 },
    { x: 130, y: 178 },
    { x: 56, y: 104 },
  ];
  const values = [
    availability?.visibility === false ? 0 : scores.visibility,
    availability?.ranking === false ? 0 : scores.ranking,
    availability?.reputation === false ? 0 : scores.reputation,
    availability?.sentiment === false ? 0 : scores.sentiment,
  ];
  const gridPolygons = [0.25, 0.5, 0.75, 1].map((scale) => (
    vertices.map((point) => `${center.x + (point.x - center.x) * scale},${center.y + (point.y - center.y) * scale}`).join(" ")
  ));
  const scorePolygon = vertices.map((point, index) => {
    const scale = Math.max(0, Math.min(100, values[index])) / 100;
    return `${center.x + (point.x - center.x) * scale},${center.y + (point.y - center.y) * scale}`;
  }).join(" ");

  return (
    <figure className="workbench-radar">
      <figcaption>{Object.values(availability || {}).some((value) => value === false) ? "可评估维度" : "四维表现"}</figcaption>
      <svg aria-label="品牌营销分析雷达图" role="img" viewBox="0 0 260 210">
        {gridPolygons.map((points, index) => (
          <polygon className="workbench-radar-grid" key={points} points={points} data-level={index + 1} />
        ))}
        {vertices.map((point) => (
          <line className="workbench-radar-axis" key={`${point.x}-${point.y}`} x1={center.x} x2={point.x} y1={center.y} y2={point.y} />
        ))}
        <polygon className="workbench-radar-area" points={scorePolygon} />
        {scorePolygon.split(" ").map((point, index) => {
          const [cx, cy] = point.split(",");
          return <circle className="workbench-radar-point" cx={cx} cy={cy} key={`${index}-${point}`} r="3.5" />;
        })}
        <text x="130" y="16" textAnchor="middle">能见</text>
        <text x="215" y="108" textAnchor="start">排名{availability?.ranking === false ? "（暂无）" : ""}</text>
        <text x="130" y="202" textAnchor="middle">口碑</text>
        <text x="45" y="108" textAnchor="end">情感</text>
      </svg>
    </figure>
  );
}

function getCycleDate(startDate: string, day: number) {
  const date = new Date(startDate);
  date.setDate(date.getDate() + day - 1);
  return date;
}

function formatMonthDay(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFullDate(date: Date) {
  return `${date.getFullYear()}年${formatMonthDay(date)}`;
}
