import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "品牌营销助手",
  description: "面向品牌商家的营销获客工具",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
