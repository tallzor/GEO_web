alter table public.brands
  add column if not exists short_name text;

update public.detection_analyses
set sentiment_label = case sentiment_label
  when '正面' then '积极'
  when '负面' then '需改善'
  else sentiment_label
end;

alter table public.detection_analyses
  alter column sentiment_label drop not null,
  alter column sentiment_label drop default;

alter table public.detection_analyses
  drop constraint if exists detection_analyses_sentiment_label_check;

alter table public.detection_analyses
  add constraint detection_analyses_sentiment_label_check
  check (sentiment_label is null or sentiment_label in ('积极', '中性', '需改善'));
