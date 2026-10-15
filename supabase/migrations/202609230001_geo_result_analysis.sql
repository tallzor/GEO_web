-- v0.3.0 GEO 检测结果：逐条呈现语义和批次事实汇总。
-- 旧四维诊断表保留用于历史数据兼容，新检测结果以 detections.result_summary 为准。

alter table public.detections
  add column if not exists result_summary jsonb;

alter table public.detection_analyses
  add column if not exists target_mentioned boolean,
  add column if not exists direct_question boolean,
  add column if not exists presentation_role text,
  add column if not exists risk_signal text;

update public.detection_analyses
set
  target_mentioned = coalesce(target_mentioned, brand_mentioned),
  presentation_role = coalesce(presentation_role, case recommendation_type
    when 'top_pick' then 'top_recommendation'
    when 'recommended' then 'alternative'
    when 'conditional' then 'alternative'
    when 'discouraged' then 'negative_counterexample'
    when 'not_mentioned' then 'not_mentioned'
    else 'general_mention'
  end)
where target_mentioned is null or presentation_role is null;

alter table public.detection_analyses
  alter column target_mentioned set default false,
  alter column target_mentioned set not null,
  alter column presentation_role set default 'not_mentioned',
  alter column presentation_role set not null;

alter table public.detection_analyses
  drop constraint if exists detection_analyses_presentation_role_check;
alter table public.detection_analyses
  add constraint detection_analyses_presentation_role_check
  check (presentation_role in (
    'top_recommendation',
    'alternative',
    'general_mention',
    'risk_warning',
    'negative_counterexample',
    'not_mentioned'
  ));

alter table public.detection_analyses
  drop constraint if exists detection_analyses_risk_signal_check;
alter table public.detection_analyses
  add constraint detection_analyses_risk_signal_check
  check (risk_signal is null or risk_signal in (
    'none_detected',
    'cautious_description',
    'negative_counterexample'
  ));

create index if not exists detections_brand_completed_idx
  on public.detections (organization_id, brand_id, completed_at desc)
  where status in ('completed', 'partial');

