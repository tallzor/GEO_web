"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, FileCheck2, FileUp, PackagePlus, Pencil, Plus, Search, Trash2, UploadCloud, UsersRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { useAccountContext } from "@/components/auth-context";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Toast } from "@/components/ui";
import { currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import { Competitor, ProductService } from "@/lib/types";
import { preflightCognition, type CognitionPreflightIssue } from "@/lib/cognition";
import { findIndustry, industryOptions } from "@/lib/industries";
import { brandNavigationItems } from "@/lib/brand-navigation";

function Frame({ children, onTabNavigate }: { children: React.ReactNode; onTabNavigate?: (href: string) => boolean }) {
  const brand = useAppStore(currentBrand);
  return <>
    <header className="page-header brand-page-header">
      <div className="page-heading-row"><h1 className="page-title">{brand?.name || "品牌档案"}</h1></div>
    </header>
    <ModuleNav items={brandNavigationItems} onNavigate={onTabNavigate} />
    {children}
  </>;
}

type NewBrandStep = 1 | 2 | 3;
type ProductDraft = Omit<ProductService, "id" | "updatedAt">;

const newProductDraft = (): ProductDraft => ({
  name: "",
  type: "product",
  description: "",
  price: "",
  features: "",
  audience: "",
  scenarios: "",
  advantages: "",
  problemsSolved: "",
  quantitativeFacts: "",
  evidence: "",
  limitations: "",
  otherInfo: "",
});

const newBrandDraft = () => ({
  name: "",
  shortName: "",
  characteristics: "",
  categoryName: "",
  trustProof: "",
  positioningStatement: "",
  industry: "",
  industryCode: "",
  industryPath: "",
  industryStandard: "",
  website: "",
  intro: "",
  serviceArea: "",
  targetAudience: "",
  coreScenarios: "",
  valuePromise: "",
  cognitionBoundary: "",
  otherInfo: "",
});

function IndustrySelect({
  code,
  onChange,
  ...controlProps
}: {
  code: string;
  onChange: (industry: ReturnType<typeof findIndustry>) => void;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return <select {...controlProps} className="select" value={code} onChange={(event) => onChange(findIndustry(event.target.value))}>
    <option value="">请选择标准行业</option>
    {industryOptions.map((item) => <option value={item.code} key={item.code}>{item.code} · {item.name}</option>)}
  </select>;
}

function PreflightNotice({ message, issues, step }: { message: string; issues: CognitionPreflightIssue[]; step: NewBrandStep }) {
  if (!message) return null;
  const visibleIssues = issues.filter((issue) => issue.step === step);
  return <div className="notice notice-danger" role="alert">
    <div>{message}</div>
    {visibleIssues.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
      {visibleIssues.map((issue) => <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>)}
    </ul>}
  </div>;
}

export function NewBrandView() {
  const router = useRouter();
  const account = useAccountContext();
  const createBrand = useAppStore((state) => state.createBrand);
  const startCognition = useAppStore((state) => state.startCognition);
  const [step, setStep] = useState<NewBrandStep>(1);
  const [basic, setBasic] = useState(newBrandDraft);
  const [products, setProducts] = useState<ProductDraft[]>(() => [newProductDraft()]);
  const [competitors, setCompetitors] = useState<Omit<Competitor, "id">[]>([]);
  const [issues, setIssues] = useState<CognitionPreflightIssue[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pendingBrandIdRef = useRef<string | null>(null);

  if (account && account.role !== "owner") {
    return <>
      <PageHeader title="新建品牌" />
      <Card><EmptyState title="暂无创建品牌权限" description="只有组织所有者可以创建品牌，请联系组织所有者操作。" /></Card>
    </>;
  }

  const validateBasic = () => {
    if (basic.name.trim()) return true;
    setStep(1);
    setIssues([{ step: 1, path: "brand.name", message: "请填写品牌名称" }]);
    setError("请填写品牌名称");
    return false;
  };

  const normalizeProducts = () => {
    const meaningful = products.filter((item) => [item.name, item.description, item.features, item.audience, item.scenarios, item.advantages, item.problemsSolved, item.quantitativeFacts, item.evidence, item.limitations, item.otherInfo].some((value) => value.trim()));
    if (meaningful.some((item) => !item.name.trim())) {
      setStep(2);
      setError("请填写已添加产品的名称");
      return null;
    }
    return meaningful.map((item) => ({
      name: item.name.trim(),
      type: item.type,
      description: item.description.trim(),
      price: "",
      features: item.features.trim(),
      audience: item.audience.trim(),
      scenarios: item.scenarios.trim(),
      advantages: item.advantages.trim(),
      problemsSolved: item.problemsSolved.trim(),
      quantitativeFacts: item.quantitativeFacts.trim(),
      evidence: item.evidence.trim(),
      limitations: item.limitations.trim(),
      otherInfo: item.otherInfo.trim(),
    }));
  };

  const normalizeCompetitors = () => {
    const meaningful = competitors.filter((item) => item.name.trim() || item.description.trim());
    if (meaningful.some((item) => !item.name.trim())) {
      setStep(3);
      setError("请填写已添加竞品的名称");
      return null;
    }
    return meaningful.map((item) => ({
      name: item.name.trim(),
      description: item.description.trim(),
    }));
  };

  const saveBrand = async (startAnalysis: boolean) => {
    if (!validateBasic()) return;
    const normalizedProducts = normalizeProducts();
    if (!normalizedProducts) return;
    const normalizedCompetitors = normalizeCompetitors();
    if (!normalizedCompetitors) return;
    if (startAnalysis) {
      const checked = preflightCognition({ brand: basic, products: normalizedProducts, competitors: normalizedCompetitors });
      setIssues(checked.issues);
      if (!checked.ready) {
        setStep(checked.issues[0].step);
        setError("尚有信息未达到分析要求，请按提示补充");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      if (!pendingBrandIdRef.current) {
        pendingBrandIdRef.current = createBrand({
          ...basic,
          name: basic.name.trim(),
          products: normalizedProducts,
          competitors: normalizedCompetitors,
        });
      }
      await flushWorkspaceNow();
      if (startAnalysis) {
        const brandId = pendingBrandIdRef.current;
        if (!brandId) throw new Error("品牌尚未保存");
        const runId = await startCognition(brandId);
        router.replace(`/brand/cognition/${runId}`);
      } else {
        router.replace("/workbench");
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "品牌保存失败，请重试");
      setSaving(false);
    }
  };

  const goToProducts = () => {
    if (!validateBasic()) return;
    setIssues([]);
    setError("");
    setStep(2);
  };

  const goToCompetitors = () => {
    if (!normalizeProducts()) return;
    setIssues([]);
    setError("");
    setStep(3);
  };

  const stepContent = {
    1: { title: "品牌基本信息", description: "品牌名称可用于保存草稿；开始分析前还需选择标准行业并填写品牌简介。" },
    2: { title: "产品或服务", description: "首次认知建立至少需要一个产品或服务，所有字段都是客户输入信息。" },
    3: { title: "竞品信息（选填）", description: "可以添加比较对象，也可以直接跳过并开始分析。" },
  }[step];

  const fieldError = (path: string) => issues.find((item) => item.path === path)?.message;
  const clearValidation = () => { setIssues([]); setError(""); };
  const updateProduct = (index: number, patch: Partial<ProductDraft>) => {
    setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, ...patch } : product));
    clearValidation();
  };

  return <>
    <PageHeader title="新建品牌" description="填写品牌与产品事实，完成后由系统异步建立认知洞察。" />
    <div className="brand-wizard-steps" aria-label="新建品牌步骤">
      {(["基本信息", "产品信息", "竞品信息"] as const).map((label, index) => {
        const itemStep = index + 1;
        return <div className={`brand-wizard-step ${step === itemStep ? "active" : step > itemStep ? "completed" : ""}`} key={label}>
          <span>{itemStep}</span><strong>{label}</strong>
        </div>;
      })}
    </div>
    <Card title={stepContent.title} description={stepContent.description}>
      {step === 1 && <form className="stack" onSubmit={(event) => { event.preventDefault(); goToProducts(); }}>
        <div className="form-row">
          <Field label="品牌名称" required error={fieldError("brand.name")}><input autoFocus className="input" value={basic.name} onChange={(event) => { setBasic({ ...basic, name: event.target.value }); clearValidation(); }} placeholder="例如：清衡食品" /></Field>
          <Field label="品牌简称"><input className="input" value={basic.shortName} onChange={(event) => setBasic({ ...basic, shortName: event.target.value })} placeholder="例如：跃动" /></Field>
        </div>
        <div className="form-row">
          <Field label="所属行业" required error={fieldError("brand.industryCode")}><IndustrySelect code={basic.industryCode} onChange={(industry) => { setBasic({ ...basic, industry: industry?.name || "", industryCode: industry?.code || "", industryPath: industry?.path || "", industryStandard: industry?.standard || "" }); clearValidation(); }} /></Field>
          <Field label="营销品类" hint="选填"><input className="input" value={basic.categoryName} onChange={(event) => setBasic({ ...basic, categoryName: event.target.value })} placeholder="例如：无糖气泡水" /></Field>
        </div>
        <Field label="品牌简介" required error={fieldError("brand.intro")}><textarea className="textarea" value={basic.intro} onChange={(event) => { setBasic({ ...basic, intro: event.target.value }); clearValidation(); }} placeholder="说明品牌是什么、主要提供什么" /></Field>
        <div className="form-row">
          <Field label="官方网站" hint="选填" error={fieldError("brand.website")}><input className="input" value={basic.website} onChange={(event) => { setBasic({ ...basic, website: event.target.value }); clearValidation(); }} placeholder="https://" /></Field>
          <Field label="服务市场" hint="选填"><input className="input" value={basic.serviceArea} onChange={(event) => setBasic({ ...basic, serviceArea: event.target.value })} placeholder="例如：全国、中国大陆或东南亚" /></Field>
        </div>
        <div className="form-row">
          <Field label="核心受众" hint="选填"><textarea className="textarea" value={basic.targetAudience} onChange={(event) => setBasic({ ...basic, targetAudience: event.target.value })} placeholder="品牌主要服务的人群或企业" /></Field>
          <Field label="核心场景" hint="选填"><textarea className="textarea" value={basic.coreScenarios} onChange={(event) => setBasic({ ...basic, coreScenarios: event.target.value })} placeholder="希望品牌在什么场景下被想到" /></Field>
        </div>
        <div className="form-row">
          <Field label="品牌定位" hint="选填"><textarea className="textarea" value={basic.positioningStatement} onChange={(event) => setBasic({ ...basic, positioningStatement: event.target.value })} /></Field>
          <Field label="价值承诺" hint="选填"><textarea className="textarea" value={basic.valuePromise} onChange={(event) => setBasic({ ...basic, valuePromise: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="品牌特质" hint="选填"><textarea className="textarea" value={basic.characteristics} onChange={(event) => setBasic({ ...basic, characteristics: event.target.value })} /></Field>
          <Field label="信任依据" hint="选填"><textarea className="textarea" value={basic.trustProof} onChange={(event) => setBasic({ ...basic, trustProof: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="认知边界" hint="选填"><textarea className="textarea" value={basic.cognitionBoundary} onChange={(event) => setBasic({ ...basic, cognitionBoundary: event.target.value })} placeholder="品牌不是什么、不能承诺什么" /></Field>
          <Field label="其他信息" hint="选填"><textarea className="textarea" value={basic.otherInfo} onChange={(event) => setBasic({ ...basic, otherInfo: event.target.value })} /></Field>
        </div>
        <PreflightNotice message={error} issues={issues} step={step} />
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => router.back()}>取消</Button><Button type="button" disabled={saving} onClick={() => void saveBrand(false)}>{saving ? "保存中…" : "保存草稿"}</Button><Button variant="primary" disabled={saving}>下一步</Button></div>
      </form>}

      {step === 2 && <form className="stack" onSubmit={(event) => { event.preventDefault(); goToCompetitors(); }}>
        {products.map((item, index) => <section className="brand-wizard-entry" key={index}>
          <header><strong>产品 {index + 1}</strong><Button type="button" size="icon" variant="ghost" aria-label={`删除产品${index + 1}`} onClick={() => setProducts(products.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></Button></header>
          <div className="form-row">
            <Field label="产品或服务名称" required error={fieldError(`products.${index}.name`)}><input className="input" value={item.name} onChange={(event) => updateProduct(index, { name: event.target.value })} placeholder="例如：清衡无糖气泡水" /></Field>
            <Field label="类型" required error={fieldError(`products.${index}.type`)}><select className="select" value={item.type} onChange={(event) => updateProduct(index, { type: event.target.value })}><option value="product">产品</option><option value="service">服务</option></select></Field>
          </div>
          <Field label="简介" required error={fieldError(`products.${index}.description`)}><textarea className="textarea" value={item.description} onChange={(event) => updateProduct(index, { description: event.target.value })} placeholder="说明具体提供什么" /></Field>
          <div className="form-row">
            <Field label="目标客户" hint="选填"><textarea className="textarea" value={item.audience} onChange={(event) => updateProduct(index, { audience: event.target.value })} /></Field>
            <Field label="应用场景" hint="选填"><textarea className="textarea" value={item.scenarios} onChange={(event) => updateProduct(index, { scenarios: event.target.value })} /></Field>
          </div>
          <div className="form-row">
            <Field label="核心特点" hint="选填" error={fieldError(`products.${index}.base`)}><textarea className="textarea" value={item.features} onChange={(event) => updateProduct(index, { features: event.target.value })} /></Field>
            <Field label="优势" hint="选填，作为待验证主张"><textarea className="textarea" value={item.advantages} onChange={(event) => updateProduct(index, { advantages: event.target.value })} /></Field>
          </div>
          <div className="form-row">
            <Field label="可解决问题" hint="选填"><textarea className="textarea" value={item.problemsSolved} onChange={(event) => updateProduct(index, { problemsSolved: event.target.value })} /></Field>
            <Field label="定量信息" hint="选填"><textarea className="textarea" value={item.quantitativeFacts} onChange={(event) => updateProduct(index, { quantitativeFacts: event.target.value })} placeholder="指标、数值、单位与适用条件" /></Field>
          </div>
          <div className="form-row">
            <Field label="证明依据" hint="选填"><textarea className="textarea" value={item.evidence} onChange={(event) => updateProduct(index, { evidence: event.target.value })} /></Field>
            <Field label="应用限制" hint="选填"><textarea className="textarea" value={item.limitations} onChange={(event) => updateProduct(index, { limitations: event.target.value })} /></Field>
          </div>
          <Field label="其他信息" hint="选填"><textarea className="textarea" value={item.otherInfo} onChange={(event) => updateProduct(index, { otherInfo: event.target.value })} /></Field>
        </section>)}
        <Button type="button" variant="soft" onClick={() => { setProducts([...products, newProductDraft()]); setError(""); }}><Plus size={16} />再添加一个产品或服务</Button>
        <PreflightNotice message={error} issues={issues} step={step} />
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => { clearValidation(); setStep(1); }}>上一步</Button><Button type="button" disabled={saving} onClick={() => void saveBrand(false)}>{saving ? "保存中…" : "保存草稿"}</Button><Button variant="primary" disabled={saving}>下一步</Button></div>
      </form>}

      {step === 3 && <form className="stack" onSubmit={(event) => { event.preventDefault(); void saveBrand(true); }}>
        {competitors.map((item, index) => <section className="brand-wizard-entry" key={index}>
          <header><strong>竞品 {index + 1}</strong><Button type="button" size="icon" variant="ghost" aria-label={`删除竞品${index + 1}`} onClick={() => setCompetitors(competitors.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></Button></header>
          <div className="form-row">
            <Field label="竞品名称" required error={fieldError(`competitors.${index}.name`)}><input className="input" value={item.name} onChange={(event) => { setCompetitors(competitors.map((competitor, itemIndex) => itemIndex === index ? { ...competitor, name: event.target.value } : competitor)); clearValidation(); }} /></Field>
            <Field label="竞品描述"><input className="input" value={item.description} onChange={(event) => setCompetitors(competitors.map((competitor, itemIndex) => itemIndex === index ? { ...competitor, description: event.target.value } : competitor))} /></Field>
          </div>
        </section>)}
        <Button type="button" variant="soft" onClick={() => { setCompetitors([...competitors, { name: "", description: "" }]); setError(""); }}><Plus size={16} />新增竞品</Button>
        <PreflightNotice message={error} issues={issues} step={step} />
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => { clearValidation(); setStep(2); }}>上一步</Button><Button type="button" disabled={saving} onClick={() => void saveBrand(false)}>保存草稿</Button><Button variant="primary" disabled={saving}>{saving ? "正在创建…" : "完成并开始分析"}</Button></div>
      </form>}
    </Card>
  </>;
}

export function BrandBasicView() {
  const brand = useAppStore(currentBrand);
  if (!brand) return null;
  return <BrandBasicForm key={brand.id} brand={brand} />;
}

function BrandBasicForm({ brand }: { brand: NonNullable<ReturnType<typeof currentBrand>> }) {
  const router = useRouter();
  const updateBrand = useAppStore((s) => s.updateBrand);
  const [toast, setToast] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const snapshot = () => ({
    name: brand.name,
    shortName: brand.shortName || "",
    characteristics: brand.characteristics || "",
    categoryName: brand.categoryName || "",
    trustProof: brand.trustProof || "",
    positioningStatement: brand.positioningStatement || "",
    industry: brand.industry,
    industryCode: brand.industryCode || "",
    industryPath: brand.industryPath || "",
    industryStandard: brand.industryStandard || "",
    website: brand.website,
    intro: brand.intro,
    serviceArea: brand.serviceArea,
    targetAudience: brand.targetAudience || "",
    coreScenarios: brand.coreScenarios || "",
    valuePromise: brand.valuePromise || "",
    cognitionBoundary: brand.cognitionBoundary || "",
    otherInfo: brand.otherInfo || "",
  });
  const [form, setForm] = useState(snapshot);
  const isDirty = JSON.stringify(form) !== JSON.stringify(snapshot());
  const questionsNeedRefresh = brand.questions.length > 0
    && (!brand.questionsGeneratedAt || Boolean(brand.questionContextUpdatedAt && brand.questionContextUpdatedAt > brand.questionsGeneratedAt));

  const cancelEditing = () => {
    setForm(snapshot());
    setSaveError("");
    setEditing(false);
  };

  const saveChanges = async (nextHref?: string) => {
    if (saving) return;
    if (!form.name.trim()) {
      setToast("请填写品牌名称");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      updateBrand(brand.id, { ...form, name: form.name.trim() });
      await flushWorkspaceNow();
      setEditing(false);
      setPendingHref(null);
      setToast("品牌信息已保存");
      if (nextHref) router.push(nextHref);
    } catch (error) {
      const message = error instanceof Error ? error.message : "品牌信息保存失败，请稍后重试";
      setSaveError(`保存失败，修改尚未写入数据库。${message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTabNavigate = (href: string) => {
    if (saving) return false;
    if (!editing) return true;
    if (!isDirty) {
      setEditing(false);
      return true;
    }
    setPendingHref(href);
    return false;
  };

  return <Frame onTabNavigate={handleTabNavigate}>
    {questionsNeedRefresh && <div className="notice notice-warning brand-refresh-notice">
      品牌核心信息已更新，建议重新生成检测问题。
      <Link className="link" href="/geo/questions/generate">重新生成问题</Link>
    </div>}
    {!editing ? <Card title="基本信息" action={<Button variant="primary" onClick={() => { setForm(snapshot()); setSaveError(""); setEditing(true); }}><Pencil size={15} />编辑</Button>}>
      <dl className="brand-detail-grid">
        <div className="brand-detail-item"><dt>品牌名称</dt><dd>{brand.name}</dd></div>
        <div className="brand-detail-item"><dt>品牌简称</dt><dd>{brand.shortName || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>品牌特质</dt><dd>{brand.characteristics || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>营销品类</dt><dd>{brand.categoryName || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>信任依据</dt><dd>{brand.trustProof || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>品牌定位</dt><dd>{brand.positioningStatement || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>所属行业</dt><dd>{brand.industryCode ? `${brand.industryCode} · ${brand.industry}` : brand.industry || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>行业标准</dt><dd>{brand.industryStandard || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>官方网站</dt><dd>{brand.website || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>品牌简介</dt><dd>{brand.intro || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>核心受众</dt><dd>{brand.targetAudience || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>服务市场</dt><dd>{brand.serviceArea || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>核心场景</dt><dd>{brand.coreScenarios || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>价值承诺</dt><dd>{brand.valuePromise || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>认知边界</dt><dd>{brand.cognitionBoundary || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>其他信息</dt><dd>{brand.otherInfo || "未填写"}</dd></div>
      </dl>
    </Card> : <Card
      className="brand-edit-card"
      title={<span className="brand-edit-heading"><span>编辑基本信息</span><span className="brand-edit-hint">修改事实不会自动改写已确认洞察；需要时可在认知洞察页主动更新。</span></span>}
      action={<div className="brand-edit-actions"><Button type="button" disabled={saving} onClick={cancelEditing}>取消</Button><Button type="submit" form="brand-basic-form" variant="primary" disabled={saving}>{saving ? "保存中..." : "保存信息"}</Button></div>}
    >
      <form id="brand-basic-form" className="stack" onSubmit={(event) => {
        event.preventDefault();
        void saveChanges();
      }}>
        {saveError && <div className="notice notice-warning" role="alert">{saveError}</div>}
        <div className="form-row">
          <Field label="品牌名称" required><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="品牌简称"><input className="input" value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="所属行业"><IndustrySelect code={form.industryCode} onChange={(industry) => setForm({ ...form, industry: industry?.name || "", industryCode: industry?.code || "", industryPath: industry?.path || "", industryStandard: industry?.standard || "" })} /></Field>
          <Field label="营销品类"><input className="input" value={form.categoryName} onChange={(event) => setForm({ ...form, categoryName: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="品牌特质"><textarea className="textarea" value={form.characteristics} onChange={(event) => setForm({ ...form, characteristics: event.target.value })} /></Field>
          <Field label="信任依据"><textarea className="textarea" value={form.trustProof} onChange={(event) => setForm({ ...form, trustProof: event.target.value })} /></Field>
        </div>
        <Field label="官方网站"><input className="input" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://" /></Field>
        <Field label="品牌简介"><textarea className="textarea" value={form.intro} onChange={(event) => setForm({ ...form, intro: event.target.value })} placeholder="说明品牌是什么、主要提供什么" /></Field>
        <div className="form-row">
          <Field label="核心受众"><textarea className="textarea" value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} /></Field>
          <Field label="核心场景"><textarea className="textarea" value={form.coreScenarios} onChange={(event) => setForm({ ...form, coreScenarios: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="品牌定位"><textarea className="textarea" value={form.positioningStatement} onChange={(event) => setForm({ ...form, positioningStatement: event.target.value })} /></Field>
          <Field label="价值承诺"><textarea className="textarea" value={form.valuePromise} onChange={(event) => setForm({ ...form, valuePromise: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="服务市场"><input className="input" value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} /></Field>
          <Field label="认知边界"><textarea className="textarea" value={form.cognitionBoundary} onChange={(event) => setForm({ ...form, cognitionBoundary: event.target.value })} /></Field>
        </div>
        <Field label="其他信息"><textarea className="textarea" value={form.otherInfo} onChange={(event) => setForm({ ...form, otherInfo: event.target.value })} /></Field>
      </form>
    </Card>}
    <Modal
      open={Boolean(pendingHref)}
      title="是否保存已编辑内容？"
      description="切换页面前，请选择如何处理当前修改。"
      onClose={() => setPendingHref(null)}
      footer={<>
        <Button disabled={saving} onClick={() => setPendingHref(null)}>继续编辑</Button>
        <Button disabled={saving} onClick={() => {
          const nextHref = pendingHref;
          setPendingHref(null);
          cancelEditing();
          if (nextHref) router.push(nextHref);
        }}>不保存并切换</Button>
        <Button variant="primary" disabled={saving} onClick={() => void saveChanges(pendingHref || undefined)}>{saving ? "保存中..." : "保存并切换"}</Button>
      </>}
    >
      <p className="secondary" style={{ margin: 0 }}>当前表单存在尚未保存的修改。</p>
    </Modal>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </Frame>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="brand-search">
    <Search size={16} aria-hidden="true" />
    <input className="input" aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
  </div>;
}

export function ProductsView() {
  const brand = useAppStore(currentBrand)!;
  const add = useAppStore((state) => state.addProduct);
  const update = useAppStore((state) => state.updateProduct);
  const remove = useAppStore((state) => state.deleteProduct);
  const [editing, setEditing] = useState<ProductService | "new" | null>(null);
  const [form, setForm] = useState<ProductDraft>(newProductDraft);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const list = useMemo(
    () => brand.products.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(normalizedSearch)),
    [brand.products, normalizedSearch],
  );
  const open = (item?: ProductService) => {
    setEditing(item || "new");
    setForm(item ? {
      name: item.name,
      type: item.type,
      description: item.description,
      price: "",
      features: item.features,
      audience: item.audience,
      scenarios: item.scenarios,
      advantages: item.advantages,
      problemsSolved: item.problemsSolved,
      quantitativeFacts: item.quantitativeFacts,
      evidence: item.evidence,
      limitations: item.limitations,
      otherInfo: item.otherInfo,
    } : newProductDraft());
  };

  return <Frame>
    <Card className="brand-list-card" title={`产品与服务（${brand.products.length}）`} action={<div className="brand-list-header-actions">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索产品或服务名称" />
        <Button variant="primary" onClick={() => open()}><Plus size={16} />新增产品</Button>
      </div>}>
      {list.length ? <div className="brand-record-list">{list.map((item) => <article className="brand-record-row" key={item.id}>
        <span className="brand-record-icon"><PackagePlus size={19} /></span>
        <div className="brand-record-content">
          <div className="brand-record-title"><h3>{item.name}</h3><Badge>{item.type === "service" ? "服务" : "产品"}</Badge></div>
          <p>{item.description || "暂无简介"}</p>
          <dl className="brand-record-meta brand-record-meta-3">
            <div><dt>目标客户</dt><dd>{item.audience || "未填写"}</dd></div>
            <div><dt>应用场景</dt><dd>{item.scenarios || "未填写"}</dd></div>
            <div><dt>核心特点</dt><dd>{item.features || "未填写"}</dd></div>
            <div><dt>优势主张</dt><dd>{item.advantages || "未填写"}</dd></div>
            <div><dt>可解决问题</dt><dd>{item.problemsSolved || "未填写"}</dd></div>
            <div><dt>应用限制</dt><dd>{item.limitations || "未填写"}</dd></div>
          </dl>
        </div>
        <div className="brand-record-actions">
          <Button size="sm" variant="ghost" onClick={() => open(item)}><Pencil size={14} />编辑</Button>
          <Button size="icon" variant="ghost" aria-label={`删除${item.name}`} onClick={() => confirm(`确认删除“${item.name}”？历史报告快照不受影响。`) && remove(brand.id, item.id)}><Trash2 size={15} /></Button>
        </div>
      </article>)}</div> : <EmptyState title={search ? "未找到相关产品或服务" : "暂无产品与服务"} description={search ? "请尝试其他名称关键词。" : "添加品牌提供的产品或服务，作为产品认知分析的事实输入。"} icon={<PackagePlus size={24} />} />}
    </Card>
    <Modal open={!!editing} title={editing === "new" ? "新增产品或服务" : "编辑产品或服务"} onClose={() => setEditing(null)} footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => {
      if (!form.name.trim()) return;
      if (editing === "new") add(brand.id, form);
      else if (editing) update(brand.id, editing.id, form);
      setEditing(null);
    }}>保存</Button></>}>
      <div className="stack">
        <div className="form-row">
          <Field label="名称" required><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="类型"><select className="select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="product">产品</option><option value="service">服务</option></select></Field>
        </div>
        <Field label="简介"><textarea className="textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <div className="form-row">
          <Field label="目标客户"><textarea className="textarea" value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></Field>
          <Field label="应用场景"><textarea className="textarea" value={form.scenarios} onChange={(event) => setForm({ ...form, scenarios: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="核心特点"><textarea className="textarea" value={form.features} onChange={(event) => setForm({ ...form, features: event.target.value })} /></Field>
          <Field label="优势" hint="作为待验证主张"><textarea className="textarea" value={form.advantages} onChange={(event) => setForm({ ...form, advantages: event.target.value })} /></Field>
        </div>
        <div className="form-row">
          <Field label="可解决问题"><textarea className="textarea" value={form.problemsSolved} onChange={(event) => setForm({ ...form, problemsSolved: event.target.value })} /></Field>
          <Field label="定量信息"><textarea className="textarea" value={form.quantitativeFacts} onChange={(event) => setForm({ ...form, quantitativeFacts: event.target.value })} placeholder="指标、数值、单位与适用条件" /></Field>
        </div>
        <div className="form-row">
          <Field label="证明依据"><textarea className="textarea" value={form.evidence} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></Field>
          <Field label="应用限制"><textarea className="textarea" value={form.limitations} onChange={(event) => setForm({ ...form, limitations: event.target.value })} /></Field>
        </div>
        <Field label="其他信息"><textarea className="textarea" value={form.otherInfo} onChange={(event) => setForm({ ...form, otherInfo: event.target.value })} /></Field>
      </div>
    </Modal>
  </Frame>;
}

export function CompetitorsView() {
  const brand = useAppStore(currentBrand)!;
  const add = useAppStore((state) => state.addCompetitor);
  const update = useAppStore((state) => state.updateCompetitor);
  const remove = useAppStore((state) => state.deleteCompetitor);
  const [editing, setEditing] = useState<Competitor | "new" | null>(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const list = useMemo(
    () => brand.competitors.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(normalizedSearch)),
    [brand.competitors, normalizedSearch],
  );
  const open = (item?: Competitor) => { setEditing(item || "new"); setForm(item ? { name: item.name, description: item.description } : { name: "", description: "" }); };
  return <Frame>
    <Card className="brand-list-card" title={`竞品信息（${brand.competitors.length}）`} action={<div className="brand-list-header-actions">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索竞品名称" />
        <Button variant="primary" onClick={() => open()}><Plus size={16} />新增竞品</Button>
      </div>}>
      {list.length ? <div className="brand-record-list">{list.map((item) => <article className="brand-record-row brand-record-row-compact" key={item.id}>
        <span className="brand-record-icon"><UsersRound size={19} /></span>
        <div className="brand-record-content">
          <div className="brand-record-title"><h3>{item.name}</h3></div>
          <p>{item.description || "暂无描述"}</p>
        </div>
        <div className="brand-record-actions">
          <Button size="sm" variant="ghost" onClick={() => open(item)}><Pencil size={14} />编辑</Button>
          <Button size="icon" variant="ghost" aria-label={`删除${item.name}`} onClick={() => confirm(`确认删除“${item.name}”？`) && remove(brand.id, item.id)}><Trash2 size={15} /></Button>
        </div>
      </article>)}</div> : <EmptyState title={search ? "未找到相关竞品" : "尚未添加竞品"} description={search ? "请尝试其他名称关键词。" : "添加1—3个主要竞品，后续检测会识别AI回答中的竞品提及。"} icon={<UsersRound size={24} />} />}
    </Card>
    <Modal open={!!editing} title={editing === "new" ? "新增竞品" : "编辑竞品"} onClose={() => setEditing(null)} footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => {
      if (!form.name.trim()) return;
      if (editing === "new") add(brand.id, form);
      else if (editing) update(brand.id, editing.id, form);
      setEditing(null);
    }}>保存</Button></>}>
      <div className="stack">
        <Field label="竞品名称" required><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="竞品描述"><textarea className="textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="记录竞品的业务、产品或市场定位" /></Field>
      </div>
    </Modal>
  </Frame>;
}

export function KnowledgeView() {
  const brand = useAppStore(currentBrand)!;
  const account = useAccountContext();
  const add = useAppStore((state) => state.addKnowledge);
  const update = useAppStore((state) => state.updateKnowledgeStatus);
  const remove = useAppStore((state) => state.deleteKnowledge);
  const dataMode = useAppStore((state) => state.dataMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [productId, setProductId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const list = useMemo(
    () => brand.knowledge.filter((item) => item.fileName.toLocaleLowerCase("zh-CN").includes(normalizedSearch)),
    [brand.knowledge, normalizedSearch],
  );
  const upload = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setUploadError("");
    const currentFile = file;
    const id = add(brand.id, {
      productId: productId || undefined,
      fileName: currentFile.name,
      fileType: currentFile.name.split(".").pop()?.toUpperCase() || "FILE",
      sizeLabel: `${Math.max(.1, currentFile.size / 1024 / 1024).toFixed(1)} MB`,
      status: "uploading",
      uploadedBy: account?.displayName,
    });
    try {
      if (dataMode === "supabase") {
        const form = new FormData();
        form.set("brandId", brand.id);
        form.set("attachmentId", id);
        if (productId) form.set("productId", productId);
        form.set("file", currentFile);
        const response = await fetch("/api/knowledge", { method: "POST", body: form });
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        if (!response.ok) throw new Error(payload?.error || "附件上传失败");
      }
      update(brand.id, id, "uploaded");
      setOpen(false);
      setFile(null);
      setProductId("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "附件上传失败";
      update(brand.id, id, "failed", message);
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };
  const deleteAttachment = async (id: string) => {
    if (!confirm("确认删除该附件？删除后将无法继续下载原文件。")) return;
    if (dataMode === "supabase") {
      const response = await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
      if (!response.ok) {
        window.alert(payload?.error || "附件删除失败");
        return;
      }
    }
    remove(brand.id, id);
  };
  const downloadAttachment = async (id: string) => {
    if (dataMode !== "supabase") {
      window.alert("本地演示模式只保存附件信息，不保存文件内容。");
      return;
    }
    const response = await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`);
    const payload = await response.json().catch(() => undefined) as { url?: string; error?: string } | undefined;
    if (!response.ok || !payload?.url) {
      window.alert(payload?.error || "附件下载链接获取失败");
      return;
    }
    window.location.assign(payload.url);
  };
  return <Frame>
    <div className="notice notice-warning brand-knowledge-notice">v0.3.0 仅保存并展示附件，不解析内容，也不将附件用于认知分析。</div>
    <Card className="brand-list-card" title={`知识附件（${brand.knowledge.length}）`} action={<div className="brand-list-header-actions">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索附件名称" />
        <Button variant="primary" onClick={() => setOpen(true)}><FileUp size={16} />上传附件</Button>
      </div>}>
      {list.length ? <div className="brand-record-list">{list.map((item) => <article className="brand-record-row brand-record-row-compact" key={item.id}>
        <span className="brand-record-icon"><FileCheck2 size={19} /></span>
        <div className="brand-record-content">
          <div className="brand-record-title">
            <h3>{item.fileName}</h3>
            <Badge tone={item.status === "uploaded" ? "success" : item.status === "failed" ? "danger" : "warning"}>{item.status === "uploaded" ? "已上传" : item.status === "failed" ? "上传失败" : "上传中"}</Badge>
          </div>
          {item.error && <p className="trend-down">{item.error}</p>}
          <dl className="brand-record-meta brand-record-meta-3">
            <div><dt>类型 / 大小</dt><dd>{item.fileType} · {item.sizeLabel}</dd></div>
            <div><dt>资料归属</dt><dd>{brand.products.find((product) => product.id === item.productId)?.name || "品牌"}</dd></div>
            <div><dt>上传人</dt><dd>{item.uploadedBy || "当前用户"}</dd></div>
            <div><dt>上传时间</dt><dd>{new Date(item.uploadedAt).toLocaleString("zh-CN")}</dd></div>
          </dl>
        </div>
        <div className="brand-record-actions">
          {item.status === "uploaded" && <Button size="sm" variant="ghost" onClick={() => void downloadAttachment(item.id)}><Download size={14} />下载</Button>}
          <Button size="icon" variant="ghost" aria-label={`删除${item.fileName}`} onClick={() => void deleteAttachment(item.id)}><Trash2 size={15} /></Button>
        </div>
      </article>)}</div> : <EmptyState title={search ? "未找到相关附件" : "尚未上传知识附件"} description={search ? "请尝试其他文件名称关键词。" : "可保存 PDF、DOCX、TXT 等品牌或产品资料，当前版本不解析内容。"} icon={<FileCheck2 size={24} />} />}
    </Card>
    <Modal open={open} title="上传知识附件" description="上传真实、有效且有权使用的品牌资料。" onClose={() => !uploading && setOpen(false)} footer={<><Button disabled={uploading} onClick={() => setOpen(false)}>取消</Button><Button variant="primary" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? "上传中" : "立即上传"}</Button></>}>
      <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" hidden onChange={(event) => { setFile(event.target.files?.[0] || null); setUploadError(""); }} />
      <button type="button" className="brand-upload-dropzone" onClick={() => inputRef.current?.click()}>
        <UploadCloud size={34} />
        <strong>{file ? file.name : "点击选择文件"}</strong>
        <span>支持 PDF、DOCX、TXT，单文件不超过20MB</span>
      </button>
      <Field label="资料归属" hint="选填，默认归入品牌">
        <select className="select" value={productId} onChange={(event) => setProductId(event.target.value)}>
          <option value="">品牌</option>
          {brand.products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}
        </select>
      </Field>
      {uploadError && <div className="notice notice-danger" style={{ marginTop: 12 }}>{uploadError}</div>}
    </Modal>
  </Frame>;
}
