import { NextResponse } from "next/server";
import { isProviderReady } from "@/lib/server/detection-task-runner";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerIds: ProviderId[] = ["doubao", "deepseek", "yuanbao"];

export async function GET(request: Request) {
  const requested = (new URL(request.url).searchParams.get("providers") || "")
    .split(",")
    .filter((provider): provider is ProviderId => providerIds.includes(provider as ProviderId));
  if (!requested.length) {
    return NextResponse.json({ error: "请至少选择一个AI平台" }, { status: 400 });
  }
  const providers = requested.map((provider) => ({ provider, ...isProviderReady(provider) }));
  const unavailable = providers.find((provider) => !provider.ready);
  return NextResponse.json(
    { ready: !unavailable, providers, error: unavailable?.message },
    {
      status: unavailable ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
