"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function ModuleNav({ items, onNavigate }: { items: { href: string; label: string }[]; onNavigate?: (href: string) => boolean }) {
  const pathname = usePathname();
  return <nav className="tabs" style={{ marginBottom: 18 }}>{items.map((item) => {
    const itemPathname = item.href.split("?", 1)[0];
    return <Link
      key={item.href}
      href={item.href}
      className={`tab ${pathname === itemPathname ? "active" : ""}`}
      onClick={(event) => {
        if (itemPathname !== pathname && onNavigate?.(item.href) === false) event.preventDefault();
      }}
    >{item.label}</Link>;
  })}</nav>;
}
