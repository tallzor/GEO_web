import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type {
  Citation,
  DetectionResult,
  DetectionRunError,
  Diagnosis,
  OptimizationSuggestion,
  ReputationTopic,
  RankedBrandMention,
  SentimentLabel,
} from "@/lib/types";
import type {
  DetectionTaskBrand,
  DetectionTaskUpdateGuard,
  ServerDetectionTask,
} from "@/lib/server/detection-task-store";
import type { DetectionTaskStatus } from "@/lib/server/detection-task-store";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value as Row[] : [];
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

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/* 已停用：检测重试现在保留已完成结果，只补跑失败单元，禁止整批清空。
export async function clearSupabaseDetectionAttemptResults(
  detectionId: string,
  organizationId?: string,
) {
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("detection_results").delete().eq("detection_id", detectionId);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}
*/

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export async function getSupabaseDetectionTask(id: string, organizationId?: string) {
  const tasks = await listSupabaseDetectionTasks(undefined, organizationId, id);
  return tasks[0];
}

export async function getSupabaseDetectionTaskStatus(
  id: string,
  organizationId?: string,
): Promise<DetectionTaskStatus | undefined> {
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("detections")
    .select("id,status,stage,total_runs,completed_runs,failed_runs,attempt,updated_at,collection_total,collection_completed,analysis_total,analysis_completed,progress_message")
    .eq("id", id);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return undefined;
  const row = data as Row;
  return {
    id: text(row.id),
    status: text(row.status) as DetectionTaskStatus["status"],
    stage: text(row.stage) as DetectionTaskStatus["stage"],
    totalRuns: numberValue(row.total_runs),
    completedRuns: numberValue(row.completed_runs),
    failedRuns: numberValue(row.failed_runs),
    attempt: numberValue(row.attempt, 1),
    updatedAt: text(row.updated_at),
    collectionTotal: numberValue(row.collection_total),
    collectionCompleted: numberValue(row.collection_completed),
    analysisTotal: numberValue(row.analysis_total),
    analysisCompleted: numberValue(row.analysis_completed),
    progressMessage: optionalText(row.progress_message),
  };
}

export async function claimNextSupabaseDetectionTask(workerId: string, leaseSeconds: number) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_next_detection_task", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? getSupabaseDetectionTask(data) : undefined;
}

export async function heartbeatSupabaseDetectionTask(id: string, workerId: string, leaseSeconds: number) {
  const { data, error } = await createSupabaseAdminClient().rpc("heartbeat_detection_task", {
    p_detection_id: id, p_worker_id: workerId, p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function releaseSupabaseDetectionTask(id: string, workerId: string) {
  const { error } = await createSupabaseAdminClient().rpc("release_detection_task_lease", {
    p_detection_id: id, p_worker_id: workerId,
  });
  if (error) throw new Error(error.message);
}

export async function markSupabaseDetectionTaskFailed(
  id: string,
  workerId: string,
  message: string,
  detail: string,
) {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const failed = await supabase.from("detections").update({
    status: "failed",
    stage: "failed",
    completed_at: now,
    progress_message: message,
    worker_id: null,
    heartbeat_at: null,
    lease_expires_at: null,
  }).eq("id", id).eq("worker_id", workerId).in("status", ["pending", "running"])
    .select("id,organization_id,brand_id,providers").maybeSingle();
  if (failed.error) throw new Error(failed.error.message);
  if (!failed.data) return false;

  const row = failed.data as Row;
  const runError = await supabase.from("detection_run_errors").upsert({
    organization_id: text(row.organization_id),
    brand_id: text(row.brand_id),
    detection_id: id,
    provider: stringArray(row.providers)[0] || null,
    question_id: null,
    run_key: "task",
    message: detail,
    category: "analysis",
    retryable: true,
  }, { onConflict: "detection_id,run_key" });
  if (runError.error) throw new Error(runError.error.message);
  return true;
}

export async function claimNextSupabaseSuggestionTask(workerId: string, leaseSeconds: number) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("claim_next_detection_suggestion", {
    p_worker_id: workerId, p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? getSupabaseDetectionTask(data) : undefined;
}

export async function listSupabaseDetectionTasks(brandId?: string, organizationId?: string, id?: string) {
  const supabase = createSupabaseAdminClient();
  let detectionsQuery = supabase.from("detections").select("*").order("created_at", { ascending: false });
  if (organizationId) detectionsQuery = detectionsQuery.eq("organization_id", organizationId);
  if (brandId) detectionsQuery = detectionsQuery.eq("brand_id", brandId);
  if (id) detectionsQuery = detectionsQuery.eq("id", id);
  const { data: detectionData, error: detectionError } = await detectionsQuery;
  if (detectionError) throw new Error(detectionError.message);
  const detectionRows = rows(detectionData);
  if (!detectionRows.length) return [];
  const detectionIds = detectionRows.map((row) => text(row.id));

  const [resultsQuery, errorsQuery, analysesQuery, diagnosesQuery] = await Promise.all([
    supabase.from("detection_results").select("*").in("detection_id", detectionIds).order("created_at"),
    supabase.from("detection_run_errors").select("*").in("detection_id", detectionIds).order("created_at"),
    supabase.from("detection_analyses").select("*").in("detection_id", detectionIds),
    supabase.from("detection_diagnoses").select("*").in("detection_id", detectionIds).eq("is_current", true),
  ]);
  const firstError = resultsQuery.error || errorsQuery.error || analysesQuery.error || diagnosesQuery.error;
  if (firstError) throw new Error(firstError.message);
  const diagnosisRows = rows(diagnosesQuery.data);
  const diagnosisIds = diagnosisRows.map((row) => text(row.id));
  const [issuesQuery, suggestionsQuery] = diagnosisIds.length
    ? await Promise.all([
        supabase.from("diagnosis_issues").select("*").in("diagnosis_id", diagnosisIds).order("sort_order"),
        supabase.from("optimization_suggestions").select("*").in("diagnosis_id", diagnosisIds).order("sort_order"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (issuesQuery.error || suggestionsQuery.error) {
    throw new Error(issuesQuery.error?.message || suggestionsQuery.error?.message || "诊断数据读取失败");
  }

  const resultRows = rows(resultsQuery.data);
  const errorRows = rows(errorsQuery.data);
  const analysisRows = rows(analysesQuery.data);
  const issueRows = rows(issuesQuery.data);
  const suggestionRows = rows(suggestionsQuery.data);

  return detectionRows.map((row): ServerDetectionTask => {
    const detectionId = text(row.id);
    const taskResults = resultRows
      .filter((item) => text(item.detection_id) === detectionId)
      .map((item) => mapResult(item, analysisRows.find((analysis) => text(analysis.result_id) === text(item.id))));
    const diagnosisRow = diagnosisRows.find((item) => text(item.detection_id) === detectionId);
    const diagnosis = diagnosisRow ? mapDiagnosis(diagnosisRow, issueRows, suggestionRows) : undefined;
    return {
      id: detectionId,
      organizationId: text(row.organization_id),
      createdBy: optionalText(row.created_by),
      brandId: text(row.brand_id),
      subjectType: text(row.subject_type) === "product" ? "product" : "brand",
      subjectId: text(row.subject_type) === "product" ? text(row.product_id) : text(row.brand_id),
      subjectName: optionalText(row.subject_name) || text(row.name),
      name: text(row.name),
      status: text(row.status) as ServerDetectionTask["status"],
      stage: text(row.stage) as ServerDetectionTask["stage"],
      providers: stringArray(row.providers) as ServerDetectionTask["providers"],
      questionIds: stringArray(row.question_ids),
      totalRuns: numberValue(row.total_runs),
      completedRuns: numberValue(row.completed_runs),
      failedRuns: numberValue(row.failed_runs),
      sourceDetectionId: optionalText(row.source_detection_id),
      dataSource: text(row.data_source) as ServerDetectionTask["dataSource"],
      collectionMethod: text(row.collection_method) as ServerDetectionTask["collectionMethod"],
      analysisModel: optionalText(row.analysis_model),
      attempt: numberValue(row.attempt, 1),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      completedAt: optionalText(row.completed_at),
      collectionTotal: numberValue(row.collection_total),
      collectionCompleted: numberValue(row.collection_completed),
      analysisTotal: numberValue(row.analysis_total),
      analysisCompleted: numberValue(row.analysis_completed),
      progressMessage: optionalText(row.progress_message),
      workerId: optionalText(row.worker_id),
      heartbeatAt: optionalText(row.heartbeat_at),
      leaseExpiresAt: optionalText(row.lease_expires_at),
      collectionModelVersions: record(row.collection_model_versions) as Record<string, string>,
      analysisPromptVersion: optionalText(row.analysis_prompt_version),
      analysisRuleVersion: optionalText(row.analysis_rule_version),
      results: taskResults,
      diagnosis,
      runErrors: errorRows.filter((item) => text(item.detection_id) === detectionId).map(mapRunError),
      serverManaged: true,
      brandSnapshot: mapBrandSnapshot(row.brand_snapshot),
      questionSnapshots: jsonArray<ServerDetectionTask["questionSnapshots"][number]>(row.question_snapshots),
    };
  });
}

export async function saveSupabaseDetectionTask(
  task: ServerDetectionTask,
  guard?: DetectionTaskUpdateGuard,
) {
  if (!task.organizationId) throw new Error("检测任务缺少组织信息");
  const supabase = createSupabaseAdminClient();
  const parentRow = {
      id: task.id,
      organization_id: task.organizationId,
      brand_id: task.brandId,
      subject_type: task.subjectType || "brand",
      product_id: task.subjectType === "product" ? task.subjectId : null,
      subject_name: task.subjectName || task.brandSnapshot.name,
      name: task.name,
      status: task.status,
      stage: task.stage,
      providers: task.providers,
      question_ids: task.questionIds,
      total_runs: task.totalRuns,
      completed_runs: task.completedRuns,
      failed_runs: task.failedRuns,
      collection_total: task.collectionTotal || 0,
      collection_completed: task.collectionCompleted || 0,
      analysis_total: task.analysisTotal || 0,
      analysis_completed: task.analysisCompleted || 0,
      progress_message: task.progressMessage || null,
      worker_id: task.workerId || null,
      heartbeat_at: task.heartbeatAt || null,
      lease_expires_at: task.leaseExpiresAt || null,
      collection_model_versions: task.collectionModelVersions || {},
      analysis_prompt_version: task.analysisPromptVersion || null,
      analysis_rule_version: task.analysisRuleVersion || null,
      source_detection_id: task.sourceDetectionId || null,
      data_source: task.dataSource || "live_api",
      collection_method: task.collectionMethod || "model_api",
      analysis_model: task.analysisModel || null,
      attempt: task.attempt || 1,
      brand_snapshot: task.brandSnapshot,
      question_snapshots: task.questionSnapshots,
      started_at: task.status === "running" ? task.updatedAt : null,
      completed_at: task.completedAt || null,
      created_by: task.createdBy || null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
  };
  const saveParent = async () => {
    const detectionResult = guard
      ? await guardedParentUpdate(supabase, parentRow, task.organizationId!, guard)
      : await supabase.from("detections").upsert(parentRow, { onConflict: "id" });
    if (detectionResult.error) throw new Error(`检测任务状态保存失败：${detectionResult.error.message}`);
    if (guard && !detectionResult.data) throw new Error("检测任务状态已变化，忽略迟到的执行结果");
  };

  // 新任务需要先建立父记录；后续步骤则先保存明细，避免明细失败却把父任务标成已完成。
  if (task.status === "pending" && task.results.length === 0 && !task.diagnosis) {
    await saveParent();
  }

  if (task.results.length) {
    const baseResult = await supabase.from("detection_results").upsert(task.results.map((result) => ({
      id: result.id,
      organization_id: task.organizationId,
      brand_id: task.brandId,
      detection_id: task.id,
      question_id: result.questionId,
      provider: result.provider,
      question_snapshot: result.questionSnapshot || task.questionSnapshots.find((question) => question.id === result.questionId)?.text || "检测问题",
      sample_no: 1,
      answer: result.answer,
      model: result.model || null,
      request_id: result.requestId || null,
      data_source: result.dataSource || task.dataSource || "live_api",
      collection_method: result.collectionMethod || task.collectionMethod || "model_api",
      latency_ms: result.latencyMs || null,
      input_tokens: result.inputTokens || null,
      output_tokens: result.outputTokens || null,
      total_tokens: result.totalTokens || null,
      web_search_enabled: result.webSearchEnabled || false,
      search_queries: result.searchQueries || [],
      web_search_unavailable_reason: result.webSearchUnavailableReason || null,
      citations: result.citations,
      collected_at: result.collectedAt || task.updatedAt,
    })), { onConflict: "id" });
    if (baseResult.error) throw new Error(`检测回答保存失败：${baseResult.error.message}`);

    const analyzed = task.results.filter((result) => Boolean(result.analysisModel));
    if (analyzed.length) {
      const analysisResult = await supabase.from("detection_analyses").upsert(analyzed.map((result) => ({
        organization_id: task.organizationId,
        brand_id: task.brandId,
        detection_id: task.id,
        result_id: result.id,
        brand_mentioned: result.brandMentioned,
        mention_count: result.mentionCount || 0,
        first_mention_index: result.firstMentionIndex ?? null,
        recommended: result.recommended,
        recommendation_type: result.recommendationType || "not_mentioned",
        recommendation_position: result.rankPosition || null,
        rank: result.rankPosition || null,
        competitor_mentions: result.competitorMentions,
        sentiment_label: result.sentimentLabel ?? null,
        sentiment_score: result.sentimentScore ?? null,
        accuracy_status: result.accuracy,
        accuracy_score: result.accuracyScore ?? null,
        conclusion: result.analysisConclusion || null,
        evidences: {
          recommendation: result.recommendationEvidence || "",
          sentiment: result.sentimentEvidence || "",
          positiveEvaluationCount: result.positiveEvaluationCount || 0,
          negativeEvaluationCount: result.negativeEvaluationCount || 0,
          accuracy: result.accuracyEvidence || "",
        },
        fact_claims: result.factClaims || [],
        ranked_brands: result.rankedBrands || [],
        reputation_topics: result.reputationTopics || [],
        analysis_model: result.analysisModel || task.analysisModel || "unknown",
        prompt_version: task.analysisPromptVersion || "detection-analysis-v4-question-batch",
      })), { onConflict: "detection_id,result_id" });
      if (analysisResult.error) throw new Error(`检测分析保存失败：${analysisResult.error.message}`);
    }
  }

  const deleteErrors = await supabase.from("detection_run_errors").delete().eq("detection_id", task.id);
  if (deleteErrors.error) throw new Error(deleteErrors.error.message);
  if (task.runErrors?.length) {
    const errorResult = await supabase.from("detection_run_errors").insert(task.runErrors.map((error, index) => ({
      organization_id: task.organizationId,
      brand_id: task.brandId,
      detection_id: task.id,
      provider: error.provider || null,
      question_id: error.questionId.startsWith("__") ? null : error.questionId,
      run_key: error.runKey || `error:${index}`,
      message: error.message,
      category: error.category || "collection",
      retryable: error.retryable || false,
    })));
    if (errorResult.error) throw new Error(errorResult.error.message);
  }

  if (!task.diagnosis) {
    if (task.stage === "failed" || (task.status === "pending" && (task.attempt || 1) > 1)) {
      const retired = await supabase.from("detection_diagnoses").update({ is_current: false })
        .eq("detection_id", task.id).eq("is_current", true);
      if (retired.error) throw new Error(retired.error.message);
    }
    await saveParent();
    return task;
  }

  const { data: currentDiagnosis, error: currentError } = await supabase.from("detection_diagnoses")
    .select("id,version").eq("detection_id", task.id).eq("is_current", true).maybeSingle();
  if (currentError) throw new Error(currentError.message);
  let diagnosisId = text((currentDiagnosis as Row | null)?.id);
  if (!diagnosisId) {
    const { data: versions, error: versionError } = await supabase.from("detection_diagnoses")
      .select("version").eq("detection_id", task.id).order("version", { ascending: false }).limit(1);
    if (versionError) throw new Error(versionError.message);
    const version = numberValue(rows(versions)[0]?.version) + 1;
    const { data, error } = await supabase.from("detection_diagnoses").insert(diagnosisRow(task, version))
      .select("id").single();
    if (error || !data) throw new Error(error?.message || "诊断保存失败");
    diagnosisId = text((data as Row).id);
  } else {
    const { error } = await supabase.from("detection_diagnoses").update(diagnosisRow(task, numberValue((currentDiagnosis as Row).version, 1)))
      .eq("id", diagnosisId);
    if (error) throw new Error(error.message);
  }

  const deleteIssues = await supabase.from("diagnosis_issues").delete().eq("diagnosis_id", diagnosisId);
  if (deleteIssues.error) throw new Error(deleteIssues.error.message);
  if (task.diagnosis.issues.length) {
    const issueResult = await supabase.from("diagnosis_issues").insert(task.diagnosis.issues.map((issue, index) => ({
      id: issue.id, organization_id: task.organizationId, brand_id: task.brandId,
      diagnosis_id: diagnosisId, dimension: issue.dimension, severity: issue.severity,
      title: issue.title, evidence: issue.evidence, sort_order: index,
    })));
    if (issueResult.error) throw new Error(issueResult.error.message);
  }
  const deleteSuggestions = await supabase.from("optimization_suggestions").delete().eq("diagnosis_id", diagnosisId);
  if (deleteSuggestions.error) throw new Error(deleteSuggestions.error.message);
  const suggestions = task.diagnosis.suggestions.slice(0, 3);
  if (suggestions.length) {
    const suggestionResult = await supabase.from("optimization_suggestions").insert(suggestions.map((suggestion, index) => ({
      id: suggestion.id, organization_id: task.organizationId, brand_id: task.brandId,
      detection_id: task.id, diagnosis_id: diagnosisId, dimension: suggestion.dimension,
      title: suggestion.title, description: suggestion.description, reason: suggestion.reason,
      selected: suggestion.selected || false, generated_by: suggestion.generatedBy || "foundation_model",
      generation_model: suggestion.generationModel || task.analysisModel || "unknown",
      prompt_version: suggestion.promptVersion || "optimization-goals-v1", sort_order: index,
    })));
    if (suggestionResult.error) throw new Error(suggestionResult.error.message);
  }
  await saveParent();
  return task;
}

async function guardedParentUpdate(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  parentRow: Record<string, unknown>,
  organizationId: string,
  guard: DetectionTaskUpdateGuard,
) {
  let query = supabase.from("detections").update(parentRow)
    .eq("id", String(parentRow.id))
    .eq("organization_id", organizationId);
  if (guard.status) query = query.eq("status", guard.status);
  if (guard.stage) query = query.eq("stage", guard.stage);
  if (guard.workerId) query = query.eq("worker_id", guard.workerId);
  return query.select("id").maybeSingle();
}

function mapResult(row: Row, analysis?: Row): DetectionResult {
  const citations = jsonArray<Citation>(row.citations);
  const evidences = record(analysis?.evidences);
  const sentimentLabel = currentSentimentLabel(analysis?.sentiment_label);
  const recommendationType = analysis ? text(analysis.recommendation_type) as DetectionResult["recommendationType"] : "not_mentioned";
  const rankPosition = optionalNumber(analysis?.rank);
  const answer = text(row.answer);
  const brandMentioned = analysis?.brand_mentioned === true;
  return {
    id: text(row.id),
    provider: text(row.provider) as DetectionResult["provider"],
    questionId: text(row.question_id),
    questionSnapshot: text(row.question_snapshot),
    answer,
    brandMentioned,
    mentionCount: numberValue(analysis?.mention_count),
    firstMentionIndex: optionalNumber(analysis?.first_mention_index),
    recommended: analysis?.recommended === true,
    recommendationType,
    recommendationPosition: recommendationLabel(recommendationType, rankPosition),
    rankPosition,
    recommendationEvidence: optionalText(evidences.recommendation),
    competitorMentions: stringArray(analysis?.competitor_mentions),
    accuracy: analysis ? text(analysis.accuracy_status) as DetectionResult["accuracy"] : "待确认",
    sentimentLabel,
    citations,
    dataSource: text(row.data_source) as DetectionResult["dataSource"],
    collectionMethod: text(row.collection_method) as DetectionResult["collectionMethod"],
    model: optionalText(row.model),
    requestId: optionalText(row.request_id),
    latencyMs: optionalNumber(row.latency_ms),
    inputTokens: optionalNumber(row.input_tokens),
    outputTokens: optionalNumber(row.output_tokens),
    totalTokens: optionalNumber(row.total_tokens),
    webSearchEnabled: row.web_search_enabled === true,
    searchQueries: stringArray(row.search_queries),
    webSearchUnavailableReason: optionalText(row.web_search_unavailable_reason),
    collectedAt: text(row.collected_at),
    analysisModel: optionalText(analysis?.analysis_model),
    analysisConclusion: optionalText(analysis?.conclusion),
    sentimentScore: optionalNumber(analysis?.sentiment_score),
    sentimentEvidence: optionalText(evidences.sentiment),
    positiveEvaluationCount: optionalNumber(evidences.positiveEvaluationCount) || 0,
    negativeEvaluationCount: optionalNumber(evidences.negativeEvaluationCount) || 0,
    accuracyScore: optionalNumber(analysis?.accuracy_score),
    accuracyEvidence: optionalText(evidences.accuracy),
    factClaims: jsonArray<string>(analysis?.fact_claims),
    rankedBrands: jsonArray<RankedBrandMention>(analysis?.ranked_brands),
    reputationTopics: normalizedReputationTopics(analysis?.reputation_topics),
    samples: [{
      index: 1,
      answer,
      brandMentioned,
      competitorMentions: stringArray(analysis?.competitor_mentions),
      citations,
      collectedAt: text(row.collected_at),
      collectionMethod: text(row.collection_method) as DetectionResult["collectionMethod"],
      mentionCount: numberValue(analysis?.mention_count),
      firstMentionIndex: optionalNumber(analysis?.first_mention_index),
      model: optionalText(row.model),
      requestId: optionalText(row.request_id),
      latencyMs: optionalNumber(row.latency_ms),
      inputTokens: optionalNumber(row.input_tokens),
      outputTokens: optionalNumber(row.output_tokens),
      totalTokens: optionalNumber(row.total_tokens),
      webSearchEnabled: row.web_search_enabled === true,
      searchQueries: stringArray(row.search_queries),
      webSearchUnavailableReason: optionalText(row.web_search_unavailable_reason),
    }],
  };
}

function mapBrandSnapshot(value: unknown): DetectionTaskBrand {
  const snapshot = record(value) as unknown as DetectionTaskBrand;
  return {
    ...snapshot,
    shortName: text(snapshot.shortName),
  };
}

function mapRunError(row: Row): DetectionRunError {
  return {
    provider: (text(row.provider) || "doubao") as DetectionRunError["provider"],
    questionId: text(row.question_id) || (text(row.category) === "analysis" ? "__analysis__" : "__task__"),
    message: text(row.message),
    runKey: text(row.run_key),
    category: text(row.category) as DetectionRunError["category"],
    retryable: row.retryable === true,
  };
}

function mapDiagnosis(row: Row, issues: Row[], suggestions: Row[]): Diagnosis {
  const diagnosisId = text(row.id);
  const seenDimensions = new Set<string>();
  const diagnosisSuggestions = suggestions
    .filter((item) => text(item.diagnosis_id) === diagnosisId)
    .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)))
    .filter((item) => {
      const dimension = text(item.dimension);
      if (!dimension || seenDimensions.has(dimension)) return false;
      seenDimensions.add(dimension);
      return true;
    })
    .sort((a, b) => numberValue(a.sort_order) - numberValue(b.sort_order))
    .slice(0, 3);
  return {
    scores: {
      visibility: numberValue(row.visibility_score),
      ranking: numberValue(row.ranking_score),
      reputation: numberValue(row.reputation_score),
      sentiment: numberValue(row.sentiment_score),
    },
    scoreAvailability: record(row.score_availability) as Diagnosis["scoreAvailability"],
    summary: text(row.summary),
    analysisModel: text(row.analysis_model),
    issues: issues.filter((item) => text(item.diagnosis_id) === diagnosisId).map((item) => ({
      id: text(item.id),
      title: text(item.title),
      severity: text(item.severity) as Diagnosis["issues"][number]["severity"],
      dimension: text(item.dimension) as Diagnosis["issues"][number]["dimension"],
      evidence: text(item.evidence),
    })),
    suggestions: diagnosisSuggestions.map((item): OptimizationSuggestion => ({
      id: text(item.id),
      title: text(item.title),
      description: text(item.description),
      reason: text(item.reason),
      dimension: text(item.dimension) as OptimizationSuggestion["dimension"],
      selected: item.selected === true,
      generatedBy: text(item.generated_by) as OptimizationSuggestion["generatedBy"],
      generationModel: text(item.generation_model),
      promptVersion: text(item.prompt_version),
    })),
    suggestionStatus: (optionalText(row.suggestion_status)
      || (diagnosisSuggestions.length ? "generated" : "not_generated")) as Diagnosis["suggestionStatus"],
    suggestionError: optionalText(row.suggestion_error),
    suggestionUpdatedAt: optionalText(row.suggestion_updated_at),
  };
}

function diagnosisRow(task: ServerDetectionTask, version: number) {
  const diagnosis = task.diagnosis!;
  return {
    organization_id: task.organizationId,
    brand_id: task.brandId,
    detection_id: task.id,
    version,
    is_current: true,
    visibility_score: diagnosis.scores.visibility,
    ranking_score: diagnosis.scores.ranking,
    reputation_score: diagnosis.scores.reputation,
    sentiment_score: diagnosis.scores.sentiment,
    score_availability: diagnosis.scoreAvailability || {},
    summary: diagnosis.summary,
    analysis_model: diagnosis.analysisModel || task.analysisModel || "unknown",
    calculation_version: task.analysisRuleVersion || "geo-four-dimensions-v3",
    prompt_version: task.analysisPromptVersion || "detection-analysis-v4-question-batch",
    suggestion_status: diagnosis.suggestionStatus || (diagnosis.suggestions.length ? "generated" : "not_generated"),
    suggestion_error: diagnosis.suggestionError || null,
    suggestion_updated_at: diagnosis.suggestionUpdatedAt || null,
  };
}

function currentSentimentLabel(value: unknown): SentimentLabel | undefined {
  const label = text(value);
  if (label === "积极" || label === "中性" || label === "需改善") return label;
  if (label === "正面") return "积极";
  if (label === "负面") return "需改善";
  return undefined;
}

function normalizedReputationTopics(value: unknown): ReputationTopic[] {
  return jsonArray<Record<string, unknown>>(value).flatMap((item) => {
    const sentimentLabel = currentSentimentLabel(item.sentimentLabel ?? item.sentiment);
    const label = text(item.label).trim();
    if (!label || !sentimentLabel) return [];
    return [{ label, sentimentLabel, evidence: text(item.evidence) }];
  });
}

function recommendationLabel(type: DetectionResult["recommendationType"], rank?: number) {
  if (type === "top_pick") return "首位推荐";
  if (type === "recommended") return rank ? `第${rank}位推荐` : "已推荐";
  if (type === "conditional") return "条件推荐";
  if (type === "mentioned_only") return "提及但未推荐";
  if (type === "discouraged") return "不推荐";
  return "未提及品牌";
}
