import { notFound } from "next/navigation";
import { DoubaoDebugView } from "@/views/doubao-debug-view";

export default function DoubaoDebugPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main style={{ width: "min(960px, calc(100% - 32px))", margin: "0 auto", padding: "32px 0 56px" }}>
      <DoubaoDebugView />
    </main>
  );
}
