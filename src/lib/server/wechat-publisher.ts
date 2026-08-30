import "server-only";

import { fetchWithTimeout } from "@/lib/supabase/fetch";

const WECHAT_API = "https://api.weixin.qq.com";

type WeChatCredentials = {
  appId: string;
  appSecret: string;
};

type WeChatErrorPayload = {
  errcode?: number;
  errmsg?: string;
};

export class WeChatPublishingError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
    this.name = "WeChatPublishingError";
  }
}

export async function verifyWeChatCredentials(credentials: WeChatCredentials) {
  await getWeChatAccessToken(credentials);
}

export async function getWeChatAccessToken(credentials: WeChatCredentials) {
  const url = new URL("/cgi-bin/token", WECHAT_API);
  url.searchParams.set("grant_type", "client_credential");
  url.searchParams.set("appid", credentials.appId);
  url.searchParams.set("secret", credentials.appSecret);
  const response = await fetchWithTimeout(url, { cache: "no-store" }, 20_000);
  const payload = await response.json().catch(() => ({})) as WeChatErrorPayload & { access_token?: string };
  if (!response.ok || !payload.access_token) throw toWeChatError(payload, response.status, "公众号凭据验证失败");
  return payload.access_token;
}

export async function uploadWeChatCover(input: {
  accessToken: string;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
}) {
  const url = new URL("/cgi-bin/material/add_material", WECHAT_API);
  url.searchParams.set("access_token", input.accessToken);
  url.searchParams.set("type", "thumb");
  const form = new FormData();
  const bytes = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer;
  form.set("media", new Blob([bytes], { type: input.contentType }), input.fileName);
  const response = await fetchWithTimeout(url, { method: "POST", body: form }, 30_000);
  const payload = await response.json().catch(() => ({})) as WeChatErrorPayload & { media_id?: string };
  if (!response.ok || !payload.media_id) throw toWeChatError(payload, response.status, "公众号封面上传失败");
  return payload.media_id;
}

export async function createWeChatDraft(input: {
  credentials: WeChatCredentials;
  title: string;
  body: string;
  coverMediaId: string;
  sourceUrl?: string;
  author?: string;
}) {
  const accessToken = await getWeChatAccessToken(input.credentials);
  const url = new URL("/cgi-bin/draft/add", WECHAT_API);
  url.searchParams.set("access_token", accessToken);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      articles: [{
        title: truncate(input.title.trim() || "品牌内容", 64),
        author: truncate(input.author?.trim() || "", 16),
        digest: truncate(plainText(input.body), 120),
        content: toWeChatHtml(input.body),
        content_source_url: input.sourceUrl || "",
        thumb_media_id: input.coverMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      }],
    }),
  }, 30_000);
  const payload = await response.json().catch(() => ({})) as WeChatErrorPayload & { media_id?: string };
  if (!response.ok || !payload.media_id) throw toWeChatError(payload, response.status, "存入公众号草稿箱失败");
  return { draftId: payload.media_id };
}

function toWeChatError(payload: WeChatErrorPayload, status: number, fallback: string) {
  const code = payload.errcode ? String(payload.errcode) : `HTTP_${status}`;
  const retryable = status >= 500 || [45009, -1].includes(payload.errcode || 0);
  const detail = payload.errmsg ? `：${payload.errmsg}` : "";
  return new WeChatPublishingError(`${fallback}${detail}`, code, retryable);
}

function plainText(value: string) {
  return value.replace(/[#>*_`\[\]()~-]/g, " ").replace(/\s+/g, " ").trim();
}

function toWeChatHtml(value: string) {
  const blocks = value.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const html = blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.every((line) => /^[-*]\s+/.test(line))) {
      return `<ul style="margin:16px 0;padding-left:24px;">${lines.map((line) => `<li style="margin:8px 0;">${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    const heading = lines[0]?.match(/^(#{1,3})\s+(.+)$/);
    if (heading && lines.length === 1) {
      const size = heading[1].length === 1 ? 24 : heading[1].length === 2 ? 20 : 17;
      return `<h2 style="margin:24px 0 12px;font-size:${size}px;line-height:1.5;color:#111827;">${escapeHtml(heading[2])}</h2>`;
    }
    return `<p style="margin:14px 0;font-size:16px;line-height:1.85;color:#1f2937;">${lines.map(escapeHtml).join("<br>")}</p>`;
  }).join("");
  return `<section style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">${html}</section>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function truncate(value: string, max: number) {
  return Array.from(value).slice(0, max).join("");
}
