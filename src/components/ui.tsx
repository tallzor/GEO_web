"use client";

import { Children, cloneElement, Fragment, isValidElement, ReactElement, ReactNode, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, FileQuestion, X } from "lucide-react";

export function Button({ children, variant = "default", size = "default", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "soft" | "danger" | "ghost"; size?: "default" | "sm" | "icon" }) {
  return <button className={`btn btn-${variant} btn-${size} ${className}`.replace("btn-default", "")} {...props}>{children}</button>;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "primary" | "success" | "warning" | "danger" }) {
  return <span className={`badge ${tone === "default" ? "" : `badge-${tone}`}`}>{children}</span>;
}

export function Card({ id, title, description, action, children, className = "" }: { id?: string; title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section id={id} className={`card ${className}`}>
    {(title || description || action) && <header className="card-header"><div>{title && <h2 className="card-title">{title}</h2>}{description && <p className="card-description">{description}</p>}</div>{action}</header>}
    <div className="card-body">{children}</div>
  </section>;
}

export function PageHeader({ title, description, actions, back = false }: { title: string; description?: string; actions?: ReactNode; back?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const returnActionExists = hasReturnLabel(actions);
  const autoBack = pathname === "/brands/new" || pathname === "/geo/new" || pathname === "/geo/compare" || pathname === "/publishes" || pathname.startsWith("/geo/progress/") || pathname.startsWith("/geo/report/") || pathname.startsWith("/geo/results/") || pathname.startsWith("/content/") || pathname.startsWith("/publish/");
  const visibleActions = stripReturnActions(actions);
  const hasVisibleActions = Children.toArray(visibleActions).length > 0;
  const showBack = back || returnActionExists || autoBack;
  return <header className="page-header"><div className="page-heading-row">{showBack && <button className="page-back" aria-label="返回上一页" onClick={() => router.back()}><ArrowLeft size={20} /></button>}<div><h1 className="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div></div>{hasVisibleActions && <div className="page-actions">{visibleActions}</div>}</header>;
}

function hasReturnLabel(node: ReactNode): boolean {
  if (typeof node === "string" || typeof node === "number") return String(node).includes("返回");
  if (!node) return false;
  if (Array.isArray(node)) return node.some(hasReturnLabel);
  if (isValidElement<{ children?: ReactNode }>(node)) return hasReturnLabel(node.props.children);
  return false;
}

function stripReturnActions(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return child;
    if (child.type === Fragment) return cloneElement(child, {}, stripReturnActions(child.props.children));
    if (hasReturnLabel(child.props.children)) return null;
    return child;
  });
}

export function Progress({ value, success = false }: { value: number; success?: boolean }) {
  return <div className={`progress ${success ? "progress-success" : ""}`}><div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) {
  return <div className="empty"><div className="empty-icon">{icon || <FileQuestion size={24} />}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ open, title, description, children, footer, onClose, dismissible = true }: { open: boolean; title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; dismissible?: boolean }) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("modal-open");
    const close = (event: KeyboardEvent) => event.key === "Escape" && dismissible && onClose();
    window.addEventListener("keydown", close);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", close);
    };
  }, [dismissible, open, onClose]);
  if (!open) return null;
  return createPortal(<><div className="overlay" onClick={dismissible ? onClose : undefined} /><section className="modal" role="dialog" aria-modal="true"><header className="modal-header"><div><h2>{title}</h2>{description && <p className="card-description">{description}</p>}</div>{dismissible && <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>}</header><div className="modal-body">{children}</div>{footer && <footer className="modal-footer">{footer}</footer>}</section></>, document.body);
}

export function Drawer({ open, title, description, children, onClose }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("modal-open");
    return () => document.body.classList.remove("modal-open");
  }, [open]);
  if (!open) return null;
  return createPortal(<><div className="overlay" onClick={onClose} /><aside className="drawer"><header className="drawer-header"><div><h2>{title}</h2>{description && <p className="card-description">{description}</p>}</div><button className="icon-btn" onClick={onClose}><X size={20} /></button></header><div className="drawer-body">{children}</div></aside></>, document.body);
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timer = window.setTimeout(onClose, 2400); return () => window.clearTimeout(timer); }, [onClose]);
  return <div className="toast"><span style={{ display: "flex", alignItems: "center", gap: 8 }}><CheckCircle2 size={17} />{message}</span></div>;
}

export function Field({ label, required, hint, error, children }: { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  const generatedId = useId();
  const child = isValidElement(children) ? children as ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }> : null;
  const controlId = child?.props.id || generatedId;
  const errorId = `${controlId}-error`;
  const control = child ? cloneElement(child, {
    id: controlId,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : child.props["aria-describedby"],
  }) : children;
  return <div className="field"><label htmlFor={controlId}>{label}{required && <span className="required">*</span>}</label>{control}{error ? <span className="field-error" id={errorId}>{error}</span> : hint && <span className="field-hint">{hint}</span>}</div>;
}
