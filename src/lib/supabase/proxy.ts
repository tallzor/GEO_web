import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getPublicSupabaseConfig,
  isSupabaseAuthEnabled,
} from "./env";
import { fetchWithTimeout } from "./fetch";

function copyCookies(source: NextResponse, target: NextResponse) {
  source.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
  return target;
}

function loginRedirect(request: NextRequest, response: NextResponse, reason?: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (reason) url.searchParams.set("error", reason);
  return copyCookies(response, NextResponse.redirect(url));
}

export async function updateSupabaseSession(request: NextRequest) {
  if (!isSupabaseAuthEnabled()) {
    return NextResponse.next({ request });
  }

  const config = getPublicSupabaseConfig();
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === "/login";
  const isApiRoute = pathname.startsWith("/api/");
  const usesIndependentTokenAuth = new Set([
    "/api/detections/worker/run",
    "/api/publishing/worker/run",
    "/api/publishing/extension/jobs/claim",
    "/api/publishing/extension/jobs/complete",
  ]).has(pathname);

  if (usesIndependentTokenAuth) {
    return NextResponse.next({ request });
  }

  if (!config) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Authentication service is not configured" },
        { status: 503 },
      );
    }
    return isLoginPage
      ? NextResponse.next({ request })
      : loginRedirect(request, NextResponse.next({ request }), "configuration");
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims?.sub);

  if (isLoginPage) {
    return authenticated
      ? copyCookies(response, NextResponse.redirect(new URL("/workbench", request.url)))
      : response;
  }

  if (!authenticated) {
    if (isApiRoute) {
      return copyCookies(
        response,
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return loginRedirect(request, response);
  }

  return response;
}
