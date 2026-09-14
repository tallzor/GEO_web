import "server-only";

import { randomBytes, randomUUID } from "node:crypto";
import type { AccountContext } from "@/lib/auth/types";
import {
  PUBLISH_TOTAL_TIMEOUT_CODE,
  PUBLISH_TOTAL_TIMEOUT_MESSAGE,
  PUBLISH_TOTAL_TIMEOUT_MS,
  hasPublishTimedOut,
} from "@/lib/publishing-timeout";
import type { ChannelContent, ChannelId, PublishBatch, PublishingPlatform, PublishRecord } from "@/lib/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyPublicationState } from "@/lib/server/optimization-repository";
import { decryptPublishingCredentials, encryptPublishingCredentials, hashExtensionToken, maskAppId } from "@/lib/server/publishing-secrets";
import { createWeChatDraft, getWeChatAccessToken, uploadWeChatCover, verifyWeChatCredentials, WeChatPublishingError } from "@/lib/server/wechat-publisher";

type Row = Record<string, unknown>;

const successfulStatuses = new Set(["draft_saved", "published"]);
const activeStatuses = new Set(["queued", "syncing", "publishing"]);

class PublishingTotalTimeoutError extends Error {
  readonly code = PUBLISH_TOTAL_TIMEOUT_CODE;

  constructor() {
    super(PUBLISH_TOTAL_TIMEOUT_MESSAGE);
    this.name = "PublishingTotalTimeoutError";
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
}

function recordFromRow(row: Row): PublishRecord {
  return {
    id: text(row.id),
    batchId: optionalText(row.batch_id),
    brandId: text(row.brand_id),
    cycleId: text(row.cycle_id),
    taskId: text(row.task_id),
    contentId: text(row.content_id),
    contentVersion: numberValue(row.content_version, 1),
    title: text(row.title_snapshot),
    bodySnapshot: text(row.body_snapshot),
    channel: text(row.channel) as ChannelId,
    accountName: text(row.account_name_snapshot),
    status: text(row.status) as PublishRecord["status"],
    attemptCount: numberValue(row.attempt_count),
    externalDraftId: optionalText(row.external_draft_id),
    externalDraftUrl: optionalText(row.external_draft_url),
    errorCode: optionalText(row.error_code),
    startedAt: optionalText(row.started_at),
    createdAt: text(row.created_at),
    completedAt: optionalText(row.completed_at),
    error: optionalText(row.error),
  };
}

function platformFromRow(row: Row): PublishingPlatform {
  return {
    id: text(row.id),
    brandId: text(row.brand_id),
    channel: text(row.channel) as ChannelId,
    name: text(row.name),
    configured: text(row.status) === "configured",
    accountName: text(row.account_name),
    verifiedAt: text(row.verified_at),
    mode: text(row.mode) as PublishingPlatform["mode"],
    appIdMasked: optionalText(row.app_id_masked),
    draftEnabled: row.draft_enabled === true,
    connectionStatus: text(row.connection_status) as PublishingPlatform["connectionStatus"],
    connectionMode: text(row.connection_mode) as PublishingPlatform["connectionMode"],
    availability: text(row.channel) === "xiaohongshu" ? "coming_soon" : "available",
    defaultCoverObjectPath: optionalText(row.default_cover_object_path),
    extensionVersion: optionalText(row.extension_version),
    lastConnectedAt: optionalText(row.last_connected_at),
    error: optionalText(row.error),
  };
}

export async function listPublishingAccounts(account: AccountContext, brandId: string) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  await assertBrand(supabase, organizationId, brandId);
  const result = await supabase.from("publishing_accounts")
    .select("id,brand_id,channel,name,account_name,mode,status,app_id_masked,draft_enabled,connection_status,connection_mode,default_cover_object_path,extension_version,last_connected_at,verified_at,error")
    .eq("organization_id", organizationId)
    .eq("brand_id", brandId);
  if (result.error) throw new Error(result.error.message);
  const platforms = rows(result.data).map(platformFromRow);
  for (const fallback of defaultPlatforms(brandId)) {
    if (!platforms.some((item) => item.channel === fallback.channel)) platforms.push(fallback);
  }
  return platforms;
}

export async function configureWeChatAccount(account: AccountContext, input: {
  brandId: string;
  accountName: string;
  appId: string;
  appSecret?: string;
  cover?: File;
}) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  await assertBrand(supabase, organizationId, input.brandId);
  const existingResult = await supabase.from("publishing_accounts")
    .select("id,credentials_ciphertext,default_cover_object_path")
    .eq("organization_id", organizationId).eq("brand_id", input.brandId).eq("channel", "wechat").maybeSingle();
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = existingResult.data as Row | null;
  const existingCredentials = text(existing?.credentials_ciphertext);
  if (!input.appSecret && !existingCredentials) throw new Error("首次配置公众号时必须填写 AppSecret");
  const credentialsCiphertext = input.appSecret
    ? encryptPublishingCredentials({ appId: input.appId, appSecret: input.appSecret })
    : existingCredentials;
  const credentials = decryptPublishingCredentials(credentialsCiphertext);
  if (credentials.appId !== input.appId && !input.appSecret) throw new Error("AppID 已变化，请同时重新填写 AppSecret");
  await verifyWeChatCredentials({ appId: credentials.appId, appSecret: credentials.appSecret });

  let coverObjectPath = text(existing?.default_cover_object_path);
  const previousCoverObjectPath = coverObjectPath;
  if (input.cover) {
    validateCover(input.cover);
    const extension = input.cover.type === "image/png" ? "png" : "jpg";
    const nextPath = `${organizationId}/${input.brandId}/wechat/default-cover-${Date.now()}.${extension}`;
    const bytes = new Uint8Array(await input.cover.arrayBuffer());
    const uploaded = await supabase.storage.from("publishing-assets").upload(nextPath, bytes, {
      contentType: input.cover.type,
      upsert: false,
    });
    if (uploaded.error) throw new Error(uploaded.error.message);
    coverObjectPath = nextPath;
  }
  if (!coverObjectPath) throw new Error("请上传一张公众号默认封面图");

  const now = new Date().toISOString();
  const accountPayload: Row = {
    ...(text(existing?.id) ? { id: text(existing?.id) } : {}),
    organization_id: organizationId,
    brand_id: input.brandId,
    channel: "wechat",
    name: "公众号",
    account_name: input.accountName,
    mode: "real",
    status: "configured",
    app_id_masked: maskAppId(input.appId),
    draft_enabled: true,
    connection_status: "connected",
    connection_mode: "server_api",
    credentials_ciphertext: credentialsCiphertext,
    default_cover_object_path: coverObjectPath,
    verified_at: now,
    error: null,
  };
  if (input.cover) accountPayload.default_cover_media_id = null;
  const saved = await supabase.from("publishing_accounts").upsert(accountPayload, { onConflict: "organization_id,brand_id,channel" }).select("id").single();
  if (saved.error) throw new Error(saved.error.message);
  if (input.cover && previousCoverObjectPath && previousCoverObjectPath !== coverObjectPath) {
    await supabase.storage.from("publishing-assets").remove([previousCoverObjectPath]);
  }
  await audit(account, "publishing_account.wechat_configured", "publishing_account", text(saved.data?.id), { brandId: input.brandId });
  return listPublishingAccounts(account, input.brandId);
}

export async function createZhihuExtensionToken(account: AccountContext, input: { brandId: string; accountName: string }) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  await assertBrand(supabase, organizationId, input.brandId);
  const token = `geoext_${randomBytes(30).toString("base64url")}`;
  const now = new Date().toISOString();
  const saved = await supabase.from("publishing_accounts").upsert({
    organization_id: organizationId,
    brand_id: input.brandId,
    channel: "zhihu",
    name: "知乎",
    account_name: input.accountName,
    mode: "real",
    status: "configured",
    draft_enabled: true,
    connection_status: "connected",
    connection_mode: "browser_extension",
    extension_token_hash: hashExtensionToken(token),
    verified_at: now,
    last_connected_at: now,
    error: null,
  }, { onConflict: "organization_id,brand_id,channel" }).select("id").single();
  if (saved.error) throw new Error(saved.error.message);
  await audit(account, "publishing_account.zhihu_token_created", "publishing_account", text(saved.data?.id), { brandId: input.brandId });
  return { token, platforms: await listPublishingAccounts(account, input.brandId) };
}

export async function createPublishBatch(account: AccountContext, input: {
  contentId: string;
  channels: ChannelId[];
  idempotencyKey: string;
}) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  const channels = [...new Set(input.channels)];
  if (!channels.length) throw new Error("请至少选择一个发布平台");
  if (channels.some((channel) => channel === "xiaohongshu")) throw new Error("小红书同步能力建设中，请选择其他平台");

  const duplicate = await supabase.from("publish_batches").select("id")
    .eq("organization_id", organizationId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data) return loadPublishBatch(account, text(duplicate.data.id));

  const contentResult = await supabase.from("contents").select("*")
    .eq("organization_id", organizationId).eq("id", input.contentId).maybeSingle();
  if (contentResult.error) throw new Error(contentResult.error.message);
  const content = contentResult.data as Row | null;
  if (!content) throw new Error("待发布内容不存在或无权访问");
  if (!["passed", "warning"].includes(text(content.risk_status))) throw new Error("请先完成风险与合规检查");
  const brandId = text(content.brand_id);

  const accountResult = await supabase.from("publishing_accounts").select("*")
    .eq("organization_id", organizationId).eq("brand_id", brandId).in("channel", channels);
  if (accountResult.error) throw new Error(accountResult.error.message);
  const publishingAccounts = rows(accountResult.data);
  for (const channel of channels) {
    const platform = publishingAccounts.find((item) => text(item.channel) === channel);
    if (!platform || text(platform.status) !== "configured" || text(platform.connection_status) !== "connected") {
      throw new Error(`${channel === "wechat" ? "公众号" : "知乎"}账号尚未完成配置`);
    }
  }

  const version = numberValue(content.current_version, 1);
  const versionResult = await supabase.from("content_versions").select("channels")
    .eq("organization_id", organizationId).eq("content_id", input.contentId).eq("version", version).maybeSingle();
  if (versionResult.error) throw new Error(versionResult.error.message);
  const channelVersions = Array.isArray(versionResult.data?.channels) ? versionResult.data.channels as ChannelContent[] : [];
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const batchInsert = await supabase.from("publish_batches").insert({
    id: batchId,
    organization_id: organizationId,
    brand_id: brandId,
    task_id: text(content.task_id),
    content_id: input.contentId,
    content_version: version,
    idempotency_key: input.idempotencyKey,
    status: "queued",
    created_by: account.userId,
  });
  if (batchInsert.error) throw new Error(batchInsert.error.message);

  const records = channels.map((channel) => {
    const platform = publishingAccounts.find((item) => text(item.channel) === channel)!;
    const channelContent = channelVersions.find((item) => item.channel === channel);
    return {
      id: randomUUID(),
      organization_id: organizationId,
      batch_id: batchId,
      brand_id: brandId,
      cycle_id: text(content.cycle_id),
      task_id: text(content.task_id),
      content_id: input.contentId,
      content_version: version,
      title_snapshot: channelContent?.title || text(content.title),
      body_snapshot: channelContent?.body || text(content.body),
      channel,
      publishing_account_id: text(platform.id),
      account_name_snapshot: text(platform.account_name),
      status: "queued",
      attempt_count: 0,
      created_at: now,
    };
  });
  const recordsInsert = await supabase.from("publish_records").insert(records);
  if (recordsInsert.error) {
    await supabase.from("publish_batches").delete().eq("organization_id", organizationId).eq("id", batchId);
    throw new Error(recordsInsert.error.message);
  }
  await applyPublicationState({
    organizationId,
    cycleId: text(content.cycle_id),
    taskId: text(content.task_id),
    contentId: input.contentId,
    status: "publishing",
  });
  const wechatRecord = records.find((record) => record.channel === "wechat");
  if (wechatRecord) {
    try {
      await enqueueWechatJob(supabase, organizationId, brandId, wechatRecord.id);
    } catch (cause) {
      await failQueuedRecord(supabase, organizationId, wechatRecord.id, cause);
      await updateBatchAggregate(supabase, batchId);
    }
  }
  await audit(account, "publish_batch.created", "publish_batch", batchId, { channels, contentId: input.contentId });
  return loadPublishBatch(account, batchId);
}

export async function loadPublishBatch(account: AccountContext, batchId: string) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  await expireTimedOutPublishRecords(supabase, { organizationId, batchId });
  const [batchResult, recordsResult] = await Promise.all([
    supabase.from("publish_batches").select("*").eq("organization_id", organizationId).eq("id", batchId).maybeSingle(),
    supabase.from("publish_records").select("*").eq("organization_id", organizationId).eq("batch_id", batchId).order("created_at"),
  ]);
  if (batchResult.error) throw new Error(batchResult.error.message);
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const batch = batchResult.data as Row | null;
  if (!batch) throw new Error("发布批次不存在或无权访问");
  return batchFromRow(batch, rows(recordsResult.data).map(recordFromRow));
}

export async function listPublishBatches(account: AccountContext, brandId: string) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  await assertBrand(supabase, organizationId, brandId);
  await expireTimedOutPublishRecords(supabase, { organizationId, brandId });
  const batchResult = await supabase.from("publish_batches").select("*")
    .eq("organization_id", organizationId).eq("brand_id", brandId).order("created_at", { ascending: false });
  if (batchResult.error) throw new Error(batchResult.error.message);
  const batches = rows(batchResult.data);
  if (!batches.length) return [];
  const recordsResult = await supabase.from("publish_records").select("*")
    .eq("organization_id", organizationId).in("batch_id", batches.map((item) => text(item.id))).order("created_at");
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const records = rows(recordsResult.data).map(recordFromRow);
  return batches.map((batch) => batchFromRow(batch, records.filter((record) => record.batchId === text(batch.id))));
}

export async function retryPublishRecord(account: AccountContext, recordId: string) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  const found = await supabase.from("publish_records").select("*")
    .eq("organization_id", organizationId).eq("id", recordId).maybeSingle();
  if (found.error) throw new Error(found.error.message);
  const record = found.data as Row | null;
  if (!record) throw new Error("发布记录不存在或无权访问");
  if (text(record.status) !== "failed") throw new Error("仅失败的平台可以重试");
  if (text(record.error_code) === PUBLISH_TOTAL_TIMEOUT_CODE) {
    throw new Error("该发布任务已超过10分钟并结束，请重新发起发布");
  }
  if (text(record.channel) === "xiaohongshu") throw new Error("小红书同步能力建设中");
  const updated = await supabase.from("publish_records").update({
    status: "queued", error: null, error_code: null, started_at: null, completed_at: null,
    created_at: new Date().toISOString(),
  }).eq("organization_id", organizationId).eq("id", recordId).eq("status", "failed");
  if (updated.error) throw new Error(updated.error.message);
  await supabase.from("publish_batches").update({ status: "running", completed_at: null })
    .eq("organization_id", organizationId).eq("id", text(record.batch_id));
  if (text(record.channel) === "wechat") {
    try {
      await enqueueWechatJob(supabase, organizationId, text(record.brand_id), recordId);
    } catch (cause) {
      await failQueuedRecord(supabase, organizationId, recordId, cause);
      await updateBatchAggregate(supabase, text(record.batch_id));
    }
  }
  await audit(account, "publish_record.retried", "publish_record", recordId, { batchId: text(record.batch_id) });
  return loadPublishBatch(account, text(record.batch_id));
}

export async function claimZhihuExtensionJob(token: string, extensionVersion?: string) {
  const supabase = createSupabaseAdminClient();
  const tokenHash = hashExtensionToken(token);
  const accountResult = await supabase.from("publishing_accounts").select("*")
    .eq("channel", "zhihu").eq("extension_token_hash", tokenHash).eq("status", "configured").maybeSingle();
  if (accountResult.error) throw new Error(accountResult.error.message);
  const publishingAccount = accountResult.data as Row | null;
  if (!publishingAccount) throw new PublishingExtensionError("扩展连接凭据无效，请重新配置", 401);
  const now = new Date().toISOString();
  await supabase.from("publishing_accounts").update({ last_connected_at: now, extension_version: extensionVersion || null })
    .eq("id", text(publishingAccount.id));
  await expireTimedOutPublishRecords(supabase, {
    organizationId: text(publishingAccount.organization_id),
    publishingAccountId: text(publishingAccount.id),
  });
  const pending = await supabase.from("publish_records").select("*")
    .eq("organization_id", text(publishingAccount.organization_id))
    .eq("publishing_account_id", text(publishingAccount.id))
    .eq("status", "queued").order("created_at").limit(1).maybeSingle();
  if (pending.error) throw new Error(pending.error.message);
  const record = pending.data as Row | null;
  if (!record) return { job: null };
  const claimed = await supabase.from("publish_records").update({
    status: "syncing", started_at: now, attempt_count: numberValue(record.attempt_count) + 1,
  }).eq("id", text(record.id)).eq("status", "queued").select("*").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { job: null };
  await supabase.from("publish_batches").update({ status: "running" }).eq("id", text(record.batch_id));
  return {
    job: {
      recordId: text(record.id),
      batchId: text(record.batch_id),
      title: text(record.title_snapshot),
      body: text(record.body_snapshot),
      createdAt: text(record.created_at),
    },
  };
}

export async function completeZhihuExtensionJob(token: string, input: {
  recordId: string;
  success: boolean;
  draftUrl?: string;
  error?: string;
}) {
  const supabase = createSupabaseAdminClient();
  const accountResult = await supabase.from("publishing_accounts").select("id,organization_id")
    .eq("channel", "zhihu").eq("extension_token_hash", hashExtensionToken(token)).eq("status", "configured").maybeSingle();
  if (accountResult.error) throw new Error(accountResult.error.message);
  const publishingAccount = accountResult.data as Row | null;
  if (!publishingAccount) throw new PublishingExtensionError("扩展连接凭据无效，请重新配置", 401);
  await expireTimedOutPublishRecords(supabase, {
    organizationId: text(publishingAccount.organization_id),
    publishingAccountId: text(publishingAccount.id),
    recordId: input.recordId,
  });
  const recordResult = await supabase.from("publish_records").select("batch_id")
    .eq("organization_id", text(publishingAccount.organization_id))
    .eq("publishing_account_id", text(publishingAccount.id))
    .eq("id", input.recordId).eq("status", "syncing").maybeSingle();
  if (recordResult.error) throw new Error(recordResult.error.message);
  const record = recordResult.data as Row | null;
  if (!record) throw new PublishingExtensionError("扩展任务不存在或状态已变化", 409);
  const now = new Date().toISOString();
  const update = await supabase.from("publish_records").update(input.success ? {
    status: "draft_saved", external_draft_url: input.draftUrl || null, error: null, error_code: null, completed_at: now,
  } : {
    status: "failed", error: input.error || "知乎草稿保存失败", error_code: "EXTENSION_FAILED", completed_at: now,
  }).eq("id", input.recordId).eq("status", "syncing").select("id").maybeSingle();
  if (update.error) throw new Error(update.error.message);
  if (!update.data) throw new PublishingExtensionError("扩展任务状态已变化，请重新发布", 409);
  await updateBatchAggregate(supabase, text(record.batch_id));
  return { ok: true };
}

export async function processNextWeChatJob(workerId: string) {
  const supabase = createSupabaseAdminClient();
  await expireTimedOutPublishRecords(supabase);
  await recoverStaleWeChatJobs(supabase);
  const pending = await supabase.from("background_jobs").select("*")
    .eq("type", "publish.wechat_draft").eq("status", "pending")
    .lte("available_at", new Date().toISOString()).order("created_at").limit(1).maybeSingle();
  if (pending.error) throw new Error(pending.error.message);
  const job = pending.data as Row | null;
  if (!job) return { processed: false };
  const claimed = await supabase.from("background_jobs").update({
    status: "running", locked_at: new Date().toISOString(), locked_by: workerId,
    attempt: numberValue(job.attempt) + 1,
  }).eq("id", text(job.id)).eq("status", "pending").select("id").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { processed: false };
  const payload = job.payload && typeof job.payload === "object" ? job.payload as Row : {};
  const recordId = text(payload.recordId);
  try {
    await publishWeChatRecord(supabase, recordId);
    await supabase.from("background_jobs").update({ status: "completed", error: null })
      .eq("id", text(job.id));
    return { processed: true, recordId, status: "draft_saved" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "公众号草稿保存失败";
    const code = error instanceof PublishingTotalTimeoutError
      ? error.code
      : error instanceof WeChatPublishingError
        ? error.code
        : "PUBLISH_FAILED";
    const recordResult = await supabase.from("publish_records").select("batch_id")
      .eq("id", recordId).maybeSingle();
    await supabase.from("publish_records").update({
      status: "failed", error: message, error_code: code, completed_at: new Date().toISOString(),
    }).eq("id", recordId).in("status", [...activeStatuses]);
    await supabase.from("background_jobs").update({ status: "failed", error: message })
      .eq("id", text(job.id));
    if (recordResult.data) await updateBatchAggregate(supabase, text(recordResult.data.batch_id));
    return { processed: true, recordId, status: "failed", error: message };
  }
}

async function publishWeChatRecord(supabase: ReturnType<typeof createSupabaseAdminClient>, recordId: string) {
  const result = await supabase.from("publish_records").select("*").eq("id", recordId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const record = result.data as Row | null;
  if (!record || text(record.channel) !== "wechat") throw new Error("公众号发布任务不存在");
  if (hasPublishTimedOut(record.created_at)) {
    await expireTimedOutPublishRecords(supabase, { recordId });
    throw new PublishingTotalTimeoutError();
  }
  const now = new Date().toISOString();
  const started = await supabase.from("publish_records").update({
    status: "syncing", started_at: now, attempt_count: numberValue(record.attempt_count) + 1,
  }).eq("id", recordId).eq("status", "queued").select("id").maybeSingle();
  if (started.error) throw new Error(started.error.message);
  if (!started.data) throw new Error("公众号发布任务状态已变化");
  const accountResult = await supabase.from("publishing_accounts").select("*")
    .eq("id", text(record.publishing_account_id)).maybeSingle();
  if (accountResult.error) throw new Error(accountResult.error.message);
  const publishingAccount = accountResult.data as Row | null;
  if (!publishingAccount || text(publishingAccount.status) !== "configured") throw new Error("公众号账号配置不可用");
  const credentials = decryptPublishingCredentials(text(publishingAccount.credentials_ciphertext));
  let coverMediaId = text(publishingAccount.default_cover_media_id);
  if (!coverMediaId) {
    const objectPath = text(publishingAccount.default_cover_object_path);
    if (!objectPath) throw new Error("公众号默认封面尚未配置");
    const downloaded = await supabase.storage.from("publishing-assets").download(objectPath);
    if (downloaded.error) throw new Error(`公众号封面读取失败：${downloaded.error.message}`);
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const accessToken = await getWeChatAccessToken({ appId: credentials.appId, appSecret: credentials.appSecret });
    coverMediaId = await uploadWeChatCover({
      accessToken,
      bytes,
      contentType: downloaded.data.type || (objectPath.endsWith(".png") ? "image/png" : "image/jpeg"),
      fileName: objectPath.split("/").pop() || "cover.jpg",
    });
    const coverUpdate = await supabase.from("publishing_accounts").update({ default_cover_media_id: coverMediaId })
      .eq("id", text(publishingAccount.id));
    if (coverUpdate.error) throw new Error(coverUpdate.error.message);
  }
  const brandResult = await supabase.from("brands").select("website,name")
    .eq("id", text(record.brand_id)).is("deleted_at", null).maybeSingle();
  if (brandResult.error) throw new Error(brandResult.error.message);
  const draft = await createWeChatDraft({
    credentials: { appId: credentials.appId, appSecret: credentials.appSecret },
    title: text(record.title_snapshot),
    body: text(record.body_snapshot),
    coverMediaId,
    sourceUrl: text(brandResult.data?.website),
    author: text(brandResult.data?.name),
  });
  if (hasPublishTimedOut(record.created_at)) {
    await expireTimedOutPublishRecords(supabase, { recordId });
    throw new PublishingTotalTimeoutError();
  }
  const completed = await supabase.from("publish_records").update({
    status: "draft_saved", external_draft_id: draft.draftId, error: null, error_code: null,
    completed_at: new Date().toISOString(),
  }).eq("id", recordId).eq("status", "syncing").select("id").maybeSingle();
  if (completed.error) throw new Error(completed.error.message);
  if (!completed.data) throw new Error("公众号发布任务状态已变化");
  await updateBatchAggregate(supabase, text(record.batch_id));
}

async function expireTimedOutPublishRecords(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: {
    organizationId?: string;
    brandId?: string;
    batchId?: string;
    recordId?: string;
    publishingAccountId?: string;
  } = {},
) {
  const staleBefore = new Date(Date.now() - PUBLISH_TOTAL_TIMEOUT_MS).toISOString();
  let query = supabase.from("publish_records").select("id,batch_id")
    .in("status", [...activeStatuses])
    .lte("created_at", staleBefore);
  if (filters.organizationId) query = query.eq("organization_id", filters.organizationId);
  if (filters.brandId) query = query.eq("brand_id", filters.brandId);
  if (filters.batchId) query = query.eq("batch_id", filters.batchId);
  if (filters.recordId) query = query.eq("id", filters.recordId);
  if (filters.publishingAccountId) query = query.eq("publishing_account_id", filters.publishingAccountId);
  const staleResult = await query;
  if (staleResult.error) throw new Error(staleResult.error.message);
  const staleRecords = rows(staleResult.data);
  if (!staleRecords.length) return [];

  const recordIds = staleRecords.map((item) => text(item.id)).filter(Boolean);
  const expired = await supabase.from("publish_records").update({
    status: "failed",
    error_code: PUBLISH_TOTAL_TIMEOUT_CODE,
    error: PUBLISH_TOTAL_TIMEOUT_MESSAGE,
    completed_at: new Date().toISOString(),
  }).in("id", recordIds).in("status", [...activeStatuses]).select("id,batch_id");
  if (expired.error) throw new Error(expired.error.message);
  const expiredRecords = rows(expired.data);
  const expiredIds = expiredRecords.map((item) => text(item.id)).filter(Boolean);
  if (!expiredIds.length) return [];

  const jobsUpdate = await supabase.from("background_jobs").update({
    status: "failed",
    error: PUBLISH_TOTAL_TIMEOUT_MESSAGE,
    locked_at: null,
    locked_by: null,
  }).eq("type", "publish.wechat_draft")
    .eq("entity_type", "publish_record")
    .in("entity_id", expiredIds)
    .in("status", ["pending", "running"]);
  if (jobsUpdate.error) throw new Error(jobsUpdate.error.message);

  const batchIds = new Set(expiredRecords.map((item) => text(item.batch_id)).filter(Boolean));
  for (const batchId of batchIds) await updateBatchAggregate(supabase, batchId);
  return expiredIds;
}

async function updateBatchAggregate(supabase: ReturnType<typeof createSupabaseAdminClient>, batchId: string) {
  const recordsResult = await supabase.from("publish_records").select("status,task_id,cycle_id,content_id,organization_id")
    .eq("batch_id", batchId);
  if (recordsResult.error) throw new Error(recordsResult.error.message);
  const records = rows(recordsResult.data);
  const successCount = records.filter((item) => successfulStatuses.has(text(item.status))).length;
  const failureCount = records.filter((item) => text(item.status) === "failed").length;
  const activeCount = records.filter((item) => activeStatuses.has(text(item.status))).length;
  const status = activeCount > 0
    ? "running"
    : successCount === records.length
      ? "succeeded"
      : successCount > 0
        ? "partial_succeeded"
        : "failed";
  const batchUpdate = await supabase.from("publish_batches").update({
    status,
    success_count: successCount,
    failure_count: failureCount,
    completed_at: activeCount === 0 ? new Date().toISOString() : null,
  }).eq("id", batchId);
  if (batchUpdate.error) throw new Error(batchUpdate.error.message);
  const first = records[0];
  if (!first) return;
  if (successCount > 0) {
    await applyPublicationState({
      organizationId: text(first.organization_id),
      cycleId: text(first.cycle_id),
      taskId: text(first.task_id),
      contentId: text(first.content_id),
      status: "published",
    });
  } else if (activeCount === 0) {
    await applyPublicationState({
      organizationId: text(first.organization_id),
      cycleId: text(first.cycle_id),
      taskId: text(first.task_id),
      contentId: text(first.content_id),
      status: "failed",
    });
  }
}

async function enqueueWechatJob(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  brandId: string,
  recordId: string,
) {
  const inserted = await supabase.from("background_jobs").insert({
    organization_id: organizationId,
    brand_id: brandId,
    type: "publish.wechat_draft",
    entity_type: "publish_record",
    entity_id: recordId,
    payload: { recordId },
    status: "pending",
    attempt: 0,
    max_attempts: 1,
  });
  if (inserted.error) throw new Error(inserted.error.message);
}

async function recoverStaleWeChatJobs(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const staleResult = await supabase.from("background_jobs").select("id,payload")
    .eq("type", "publish.wechat_draft").eq("status", "running").lt("locked_at", staleBefore);
  if (staleResult.error) throw new Error(staleResult.error.message);
  const staleJobs = rows(staleResult.data);
  for (const job of staleJobs) {
    const payload = job.payload && typeof job.payload === "object" ? job.payload as Row : {};
    const recordId = text(payload.recordId);
    if (recordId) {
      const recordUpdate = await supabase.from("publish_records").update({ status: "queued", started_at: null })
        .eq("id", recordId).eq("status", "syncing");
      if (recordUpdate.error) throw new Error(recordUpdate.error.message);
    }
    const jobUpdate = await supabase.from("background_jobs").update({
      status: "pending", locked_at: null, locked_by: null, available_at: new Date().toISOString(),
    }).eq("id", text(job.id)).eq("status", "running");
    if (jobUpdate.error) throw new Error(jobUpdate.error.message);
  }
}

async function failQueuedRecord(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  recordId: string,
  cause: unknown,
) {
  const message = cause instanceof Error ? cause.message : "同步任务加入队列失败";
  const failed = await supabase.from("publish_records").update({
    status: "failed",
    error_code: "QUEUE_ENQUEUE_FAILED",
    error: message,
    completed_at: new Date().toISOString(),
  }).eq("organization_id", organizationId).eq("id", recordId);
  if (failed.error) throw new Error(failed.error.message);
}

function batchFromRow(row: Row, records: PublishRecord[]): PublishBatch {
  return {
    id: text(row.id),
    brandId: text(row.brand_id),
    taskId: text(row.task_id),
    contentId: text(row.content_id),
    contentVersion: numberValue(row.content_version, 1),
    idempotencyKey: text(row.idempotency_key),
    status: text(row.status) as PublishBatch["status"],
    successCount: numberValue(row.success_count),
    failureCount: numberValue(row.failure_count),
    createdAt: text(row.created_at),
    completedAt: optionalText(row.completed_at),
    records,
  };
}

function defaultPlatforms(brandId: string): PublishingPlatform[] {
  return [
    { brandId, channel: "wechat", name: "公众号", configured: false, accountName: "", verifiedAt: "", mode: "real", draftEnabled: false, connectionStatus: "disconnected", connectionMode: "server_api", availability: "available" },
    { brandId, channel: "zhihu", name: "知乎", configured: false, accountName: "", verifiedAt: "", mode: "real", draftEnabled: true, connectionStatus: "disconnected", connectionMode: "browser_extension", availability: "available" },
    { brandId, channel: "xiaohongshu", name: "小红书", configured: false, accountName: "", verifiedAt: "", mode: "real", connectionStatus: "disconnected", connectionMode: "unavailable", availability: "coming_soon" },
  ];
}

function validateCover(file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type)) throw new Error("公众号封面仅支持 JPG 或 PNG");
  if (file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error("公众号封面大小必须在2MB以内");
}

function requireOrganization(account: AccountContext) {
  if (!account.organizationId) throw new Error("账号尚未分配组织");
  return account.organizationId;
}

async function assertBrand(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  brandId: string,
) {
  const result = await supabase.from("brands").select("id")
    .eq("organization_id", organizationId).eq("id", brandId).is("deleted_at", null).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("品牌不存在或无权访问");
}

async function audit(account: AccountContext, action: string, entityType: string, entityId: string, metadata: Row) {
  const organizationId = requireOrganization(account);
  const supabase = createSupabaseAdminClient();
  const result = await supabase.from("audit_logs").insert({
    organization_id: organizationId,
    user_id: account.userId,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata,
  });
  if (result.error) throw new Error(result.error.message);
}

export class PublishingExtensionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PublishingExtensionError";
  }
}
