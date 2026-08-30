"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheck2, FileUp, PackagePlus, Pencil, Plus, Search, Trash2, UploadCloud, UsersRound } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ModuleNav } from "@/components/module-nav";
import { useAccountContext } from "@/components/auth-context";
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Toast } from "@/components/ui";
import { currentBrand, flushWorkspaceNow, useAppStore } from "@/lib/store";
import { Competitor, ProductService } from "@/lib/types";

const brandNav = [
  { href: "/brand/basic", label: "基本信息" },
  { href: "/brand/products", label: "产品与服务" }, { href: "/brand/competitors", label: "竞品信息" }, { href: "/brand/knowledge", label: "知识附件" },
];

function Frame({ children, onTabNavigate }: { children: React.ReactNode; onTabNavigate?: (href: string) => boolean }) {
  const brand = useAppStore(currentBrand);
  return <>
    <header className="page-header brand-page-header">
      <div className="page-heading-row"><h1 className="page-title">{brand?.name || "品牌档案"}</h1></div>
    </header>
    <ModuleNav items={brandNav} onNavigate={onTabNavigate} />
    {children}
  </>;
}

type NewBrandStep = 1 | 2 | 3;
type ProductDraft = Omit<ProductService, "id" | "updatedAt">;

const newProductDraft = (): ProductDraft => ({
  name: "",
  type: "课程",
  description: "",
  price: "",
  features: "",
  audience: "",
});

export function NewBrandView() {
  const router = useRouter();
  const account = useAccountContext();
  const createBrand = useAppStore((state) => state.createBrand);
  const [step, setStep] = useState<NewBrandStep>(1);
  const [basic, setBasic] = useState({
    name: "",
    shortName: "",
    characteristics: "",
    categoryName: "",
    trustProof: "",
    positioningStatement: "",
    industry: "",
    intro: "",
    serviceArea: "",
    targetAudience: "",
  });
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [competitors, setCompetitors] = useState<Omit<Competitor, "id">[]>([]);
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
    setError("请填写品牌名称");
    return false;
  };

  const normalizeProducts = () => {
    const meaningful = products.filter((item) => item.name.trim() || item.description.trim() || item.price.trim() || item.features.trim() || item.audience.trim());
    if (meaningful.some((item) => !item.name.trim())) {
      setStep(2);
      setError("请填写已添加产品的名称");
      return null;
    }
    return meaningful.map((item) => ({
      ...item,
      name: item.name.trim(),
      description: item.description.trim(),
      price: item.price.trim(),
      features: item.features.trim(),
      audience: item.audience.trim(),
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

  const completeCreation = async () => {
    if (!validateBasic()) return;
    const normalizedProducts = normalizeProducts();
    if (!normalizedProducts) return;
    const normalizedCompetitors = normalizeCompetitors();
    if (!normalizedCompetitors) return;
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
      router.replace("/workbench");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "品牌保存失败，请重试");
      setSaving(false);
    }
  };

  const goToProducts = () => {
    if (!validateBasic()) return;
    setError("");
    setStep(2);
  };

  const goToCompetitors = () => {
    if (!normalizeProducts()) return;
    setError("");
    setStep(3);
  };

  const stepContent = {
    1: { title: "基本信息", description: "仅品牌名称必填；保存可直接完成创建，也可以继续补充产品和竞品。" },
    2: { title: "产品信息", description: "产品信息可以留空，点击下一步即可直接进入竞品信息。" },
    3: { title: "竞品信息", description: "竞品信息可以留空，点击完成后将创建品牌并进入工作台。" },
  }[step];

  return <>
    <PageHeader title="新建品牌" description="按步骤建立品牌档案，产品和竞品信息均可稍后完善。" />
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
          <Field label="品牌名称" required><input autoFocus className="input" value={basic.name} onChange={(event) => { setBasic({ ...basic, name: event.target.value }); setError(""); }} placeholder="例如：跃动健身" /></Field>
          <Field label="品牌简称"><input className="input" value={basic.shortName} onChange={(event) => setBasic({ ...basic, shortName: event.target.value })} placeholder="例如：跃动" /></Field>
        </div>
        <div className="form-row">
          <Field label="特性" hint="选填"><input className="input" value={basic.characteristics} onChange={(event) => setBasic({ ...basic, characteristics: event.target.value })} placeholder="例如：低门槛、有人指导、适合新手" /></Field>
          <Field label="品类名" hint="选填"><input className="input" value={basic.categoryName} onChange={(event) => setBasic({ ...basic, categoryName: event.target.value })} placeholder="例如：本地健身服务" /></Field>
        </div>
        <div className="form-row">
          <Field label="信任状" hint="选填"><input className="input" value={basic.trustProof} onChange={(event) => setBasic({ ...basic, trustProof: event.target.value })} placeholder="例如：专业教练团队、服务案例或资质" /></Field>
          <Field label="定位语" hint="选填"><input className="input" value={basic.positioningStatement} onChange={(event) => setBasic({ ...basic, positioningStatement: event.target.value })} placeholder="例如：让城市上班族轻松开始科学健身" /></Field>
        </div>
        <div className="form-row">
          <Field label="所属行业" hint="选填"><select className="select" value={basic.industry} onChange={(event) => setBasic({ ...basic, industry: event.target.value })}><option value="">请选择所属行业</option><option>健身</option><option>餐饮</option><option>美容美发</option><option>教育培训</option><option>其他本地生活</option></select></Field>
          <Field label="服务市场" hint="选填"><input className="input" value={basic.serviceArea} onChange={(event) => setBasic({ ...basic, serviceArea: event.target.value })} placeholder="例如：上海浦东新区或全国" /></Field>
        </div>
        <Field label="品牌描述" hint="选填"><textarea className="textarea" value={basic.intro} onChange={(event) => setBasic({ ...basic, intro: event.target.value })} placeholder="介绍品牌提供的服务、特点和定位" /></Field>
        <Field label="目标人群" hint="选填"><textarea className="textarea" value={basic.targetAudience} onChange={(event) => setBasic({ ...basic, targetAudience: event.target.value })} placeholder="例如：健身新手、附近上班族、希望减脂塑形的人群" /></Field>
        {error && <div className="notice notice-danger">{error}</div>}
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => router.back()}>取消</Button><Button type="button" disabled={saving} onClick={() => void completeCreation()}>{saving ? "保存中…" : "保存"}</Button><Button variant="primary" disabled={saving}>下一步</Button></div>
      </form>}

      {step === 2 && <form className="stack" onSubmit={(event) => { event.preventDefault(); goToCompetitors(); }}>
        {products.map((item, index) => <section className="brand-wizard-entry" key={index}>
          <header><strong>产品 {index + 1}</strong><Button type="button" size="icon" variant="ghost" aria-label={`删除产品${index + 1}`} onClick={() => setProducts(products.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></Button></header>
          <div className="form-row">
            <Field label="产品名称" required><input className="input" value={item.name} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, name: event.target.value } : product))} placeholder="例如：新手体验课" /></Field>
            <Field label="产品类型"><select className="select" value={item.type} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, type: event.target.value } : product))}><option>课程</option><option>套餐</option><option>服务</option><option>产品</option></select></Field>
          </div>
          <Field label="产品简介"><textarea className="textarea" value={item.description} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, description: event.target.value } : product))} placeholder="介绍产品或服务内容" /></Field>
          <div className="form-row">
            <Field label="价格说明"><input className="input" value={item.price} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, price: event.target.value } : product))} placeholder="例如：到店咨询" /></Field>
            <Field label="适用人群"><input className="input" value={item.audience} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, audience: event.target.value } : product))} /></Field>
          </div>
          <Field label="核心特点"><textarea className="textarea" value={item.features} onChange={(event) => setProducts(products.map((product, itemIndex) => itemIndex === index ? { ...product, features: event.target.value } : product))} /></Field>
        </section>)}
        <Button type="button" variant="soft" onClick={() => { setProducts([...products, newProductDraft()]); setError(""); }}><Plus size={16} />新增产品</Button>
        {error && <div className="notice notice-danger">{error}</div>}
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => { setError(""); setStep(1); }}>上一步</Button><Button type="button" disabled={saving} onClick={() => void completeCreation()}>{saving ? "保存中…" : "保存"}</Button><Button variant="primary" disabled={saving}>下一步</Button></div>
      </form>}

      {step === 3 && <form className="stack" onSubmit={(event) => { event.preventDefault(); void completeCreation(); }}>
        {competitors.map((item, index) => <section className="brand-wizard-entry" key={index}>
          <header><strong>竞品 {index + 1}</strong><Button type="button" size="icon" variant="ghost" aria-label={`删除竞品${index + 1}`} onClick={() => setCompetitors(competitors.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={16} /></Button></header>
          <div className="form-row">
            <Field label="竞品名称" required><input className="input" value={item.name} onChange={(event) => setCompetitors(competitors.map((competitor, itemIndex) => itemIndex === index ? { ...competitor, name: event.target.value } : competitor))} /></Field>
            <Field label="竞品描述"><input className="input" value={item.description} onChange={(event) => setCompetitors(competitors.map((competitor, itemIndex) => itemIndex === index ? { ...competitor, description: event.target.value } : competitor))} /></Field>
          </div>
        </section>)}
        <Button type="button" variant="soft" onClick={() => { setCompetitors([...competitors, { name: "", description: "" }]); setError(""); }}><Plus size={16} />新增竞品</Button>
        {error && <div className="notice notice-danger">{error}</div>}
        <div className="form-actions"><Button type="button" disabled={saving} onClick={() => { setError(""); setStep(2); }}>上一步</Button><Button variant="primary" disabled={saving}>{saving ? "保存中…" : "完成"}</Button></div>
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
    website: brand.website,
    intro: brand.intro,
    city: brand.city,
    serviceArea: brand.serviceArea,
    targetAudience: brand.targetAudience || "",
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
        <div className="brand-detail-item"><dt>特性</dt><dd>{brand.characteristics || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>品类名</dt><dd>{brand.categoryName || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>信任状</dt><dd>{brand.trustProof || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>定位语</dt><dd>{brand.positioningStatement || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>所属行业</dt><dd>{brand.industry || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>官方网站</dt><dd>{brand.website || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>品牌描述</dt><dd>{brand.intro || "未填写"}</dd></div>
        <div className="brand-detail-item brand-detail-wide"><dt>目标人群</dt><dd>{brand.targetAudience || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>所在城市</dt><dd>{brand.city || "未填写"}</dd></div>
        <div className="brand-detail-item"><dt>服务市场</dt><dd>{brand.serviceArea || "未填写"}</dd></div>
      </dl>
    </Card> : <Card
      className="brand-edit-card"
      title={<span className="brand-edit-heading"><span>编辑基本信息</span><span className="brand-edit-hint">仅品牌名称必填；其他资料越完整，系统生成的问题越贴合。</span></span>}
      action={<div className="brand-edit-actions"><Button type="button" disabled={saving} onClick={cancelEditing}>取消</Button><Button type="submit" form="brand-basic-form" variant="primary" disabled={saving}>{saving ? "保存中..." : "保存信息"}</Button></div>}
    >
      <form id="brand-basic-form" className="stack" onSubmit={(event) => {
        event.preventDefault();
        void saveChanges();
      }}>
        {saveError && <div className="notice notice-warning" role="alert">{saveError}</div>}
        <div className="form-row">
          <Field label="品牌名称" required><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="品牌简称"><input className="input" value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} placeholder="例如：跃动" /></Field>
        </div>
        <div className="form-row">
          <Field label="特性"><input className="input" value={form.characteristics} onChange={(event) => setForm({ ...form, characteristics: event.target.value })} placeholder="例如：低门槛、有人指导、适合新手" /></Field>
          <Field label="品类名"><input className="input" value={form.categoryName} onChange={(event) => setForm({ ...form, categoryName: event.target.value })} placeholder="例如：本地健身服务" /></Field>
        </div>
        <div className="form-row">
          <Field label="信任状"><input className="input" value={form.trustProof} onChange={(event) => setForm({ ...form, trustProof: event.target.value })} placeholder="例如：专业教练团队、服务案例或资质" /></Field>
          <Field label="定位语"><input className="input" value={form.positioningStatement} onChange={(event) => setForm({ ...form, positioningStatement: event.target.value })} placeholder="例如：让城市上班族轻松开始科学健身" /></Field>
        </div>
        <Field label="所属行业"><select className="select" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })}><option value="">请选择所属行业</option><option>健身</option><option>餐饮</option><option>美容美发</option><option>教育培训</option><option>其他本地生活</option></select></Field>
        <Field label="官方网站"><input className="input" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://" /></Field>
        <Field label="品牌描述"><textarea className="textarea" value={form.intro} onChange={(event) => setForm({ ...form, intro: event.target.value })} placeholder="介绍品牌定位、特点和主要服务" /></Field>
        <Field label="目标人群"><textarea className="textarea" value={form.targetAudience} onChange={(event) => setForm({ ...form, targetAudience: event.target.value })} placeholder="描述品牌主要服务的人群" /></Field>
        <div className="form-row">
          <Field label="所在城市"><input className="input" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></Field>
          <Field label="服务市场"><input className="input" value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} placeholder="例如：朝阳区及周边商圈或全国" /></Field>
        </div>
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

const emptyProduct = { name: "", type: "课程", description: "", price: "", features: "", audience: "" };

export function ProductsView() {
  const brand = useAppStore(currentBrand)!;
  const add = useAppStore((state) => state.addProduct);
  const update = useAppStore((state) => state.updateProduct);
  const remove = useAppStore((state) => state.deleteProduct);
  const [editing, setEditing] = useState<ProductService | "new" | null>(null);
  const [form, setForm] = useState(emptyProduct);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("zh-CN");
  const list = useMemo(
    () => brand.products.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(normalizedSearch)),
    [brand.products, normalizedSearch],
  );
  const open = (item?: ProductService) => {
    setEditing(item || "new");
    setForm(item ? { name: item.name, type: item.type, description: item.description, price: item.price, features: item.features, audience: item.audience } : emptyProduct);
  };

  return <Frame>
    <Card className="brand-list-card" title={`产品与服务（${brand.products.length}）`} action={<div className="brand-list-header-actions">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索产品或服务名称" />
        <Button variant="primary" onClick={() => open()}><Plus size={16} />新增产品</Button>
      </div>}>
      {list.length ? <div className="brand-record-list">{list.map((item) => <article className="brand-record-row" key={item.id}>
        <span className="brand-record-icon"><PackagePlus size={19} /></span>
        <div className="brand-record-content">
          <div className="brand-record-title"><h3>{item.name}</h3><Badge>{item.type}</Badge></div>
          <p>{item.description || "暂无简介"}</p>
          <dl className="brand-record-meta brand-record-meta-3">
            <div><dt>价格说明</dt><dd>{item.price || "未填写"}</dd></div>
            <div><dt>核心特点</dt><dd>{item.features || "未填写"}</dd></div>
            <div><dt>适用人群</dt><dd>{item.audience || "未填写"}</dd></div>
          </dl>
        </div>
        <div className="brand-record-actions">
          <Button size="sm" variant="ghost" onClick={() => open(item)}><Pencil size={14} />编辑</Button>
          <Button size="icon" variant="ghost" aria-label={`删除${item.name}`} onClick={() => confirm(`确认删除“${item.name}”？历史报告快照不受影响。`) && remove(brand.id, item.id)}><Trash2 size={15} /></Button>
        </div>
      </article>)}</div> : <EmptyState title={search ? "未找到相关产品或服务" : "暂无产品与服务"} description={search ? "请尝试其他名称关键词。" : "添加课程、套餐或服务，帮助AI准确理解品牌提供什么。"} icon={<PackagePlus size={24} />} />}
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
          <Field label="类型"><select className="select" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option>课程</option><option>套餐</option><option>服务</option><option>产品</option></select></Field>
        </div>
        <Field label="简介"><textarea className="textarea" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <Field label="价格说明"><input className="input" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field>
        <Field label="核心特点"><textarea className="textarea" value={form.features} onChange={(event) => setForm({ ...form, features: event.target.value })} /></Field>
        <Field label="适用人群"><input className="input" value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })} /></Field>
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
  const add = useAppStore((state) => state.addKnowledge);
  const update = useAppStore((state) => state.updateKnowledgeStatus);
  const remove = useAppStore((state) => state.deleteKnowledge);
  const dataMode = useAppStore((state) => state.dataMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
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
    const id = add(brand.id, { fileName: currentFile.name, fileType: currentFile.name.split(".").pop()?.toUpperCase() || "FILE", sizeLabel: `${Math.max(.1, currentFile.size / 1024 / 1024).toFixed(1)} MB`, status: "parsing", factCount: 0 });
    try {
      if (dataMode === "supabase") {
        const form = new FormData();
        form.set("brandId", brand.id);
        form.set("attachmentId", id);
        form.set("file", currentFile);
        const response = await fetch("/api/knowledge", { method: "POST", body: form });
        const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
        if (!response.ok) throw new Error(payload?.error || "附件上传失败");
      }
      update(brand.id, id, "active");
      setOpen(false);
      setFile(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "附件上传失败";
      update(brand.id, id, "failed", message);
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };
  const deleteAttachment = async (id: string) => {
    if (!confirm("确认删除该附件？历史内容使用的事实快照会保留。")) return;
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
  return <Frame>
    <div className="notice notice-warning brand-knowledge-notice">仅使用解析成功、已生效的附件作为正式品牌事实；解析中或失败的资料不会进入内容生成。</div>
    <Card className="brand-list-card" title={`知识附件（${brand.knowledge.length}）`} action={<div className="brand-list-header-actions">
        <SearchBox value={search} onChange={setSearch} placeholder="搜索附件名称" />
        <Button variant="primary" onClick={() => setOpen(true)}><FileUp size={16} />上传附件</Button>
      </div>}>
      {list.length ? <div className="brand-record-list">{list.map((item) => <article className="brand-record-row brand-record-row-compact" key={item.id}>
        <span className="brand-record-icon"><FileCheck2 size={19} /></span>
        <div className="brand-record-content">
          <div className="brand-record-title">
            <h3>{item.fileName}</h3>
            <Badge tone={item.status === "active" ? "success" : item.status === "failed" ? "danger" : "warning"}>{item.status === "active" ? "已生效" : item.status === "failed" ? "解析失败" : "解析中"}</Badge>
          </div>
          {item.error && <p className="trend-down">{item.error}</p>}
          <dl className="brand-record-meta brand-record-meta-3">
            <div><dt>类型 / 大小</dt><dd>{item.fileType} · {item.sizeLabel}</dd></div>
            <div><dt>提取事实</dt><dd>{item.status === "active" ? `${dataMode === "supabase" ? item.factCount : item.factCount || 12} 条` : "—"}</dd></div>
            <div><dt>上传时间</dt><dd>{new Date(item.uploadedAt).toLocaleString("zh-CN")}</dd></div>
          </dl>
        </div>
        <div className="brand-record-actions">
          {item.status === "failed" && <Button size="sm" onClick={() => { update(brand.id, item.id, "parsing"); setTimeout(() => update(brand.id, item.id, "active"), 1200); }}>重试解析</Button>}
          <Button size="icon" variant="ghost" aria-label={`删除${item.fileName}`} onClick={() => void deleteAttachment(item.id)}><Trash2 size={15} /></Button>
        </div>
      </article>)}</div> : <EmptyState title={search ? "未找到相关附件" : "尚未上传知识附件"} description={search ? "请尝试其他文件名称关键词。" : "支持PDF、DOCX、TXT等品牌介绍、课程资料或常见问答。"} icon={<FileCheck2 size={24} />} />}
    </Card>
    <Modal open={open} title="上传知识附件" description="上传真实、有效且有权使用的品牌资料。" onClose={() => !uploading && setOpen(false)} footer={<><Button disabled={uploading} onClick={() => setOpen(false)}>取消</Button><Button variant="primary" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? "上传中" : "立即上传"}</Button></>}>
      <input ref={inputRef} type="file" accept=".pdf,.docx,.txt" hidden onChange={(event) => { setFile(event.target.files?.[0] || null); setUploadError(""); }} />
      <button className="brand-upload-dropzone" onClick={() => inputRef.current?.click()}>
        <UploadCloud size={34} />
        <strong>{file ? file.name : "点击选择文件"}</strong>
        <span>支持 PDF、DOCX、TXT，单文件不超过20MB</span>
      </button>
      {uploadError && <div className="notice notice-danger" style={{ marginTop: 12 }}>{uploadError}</div>}
    </Modal>
  </Frame>;
}
