-- 将检测情感口径统一为：积极 / 中性 / 需改善 / 无结果(null)。
-- 本迁移可重复执行，用于修复早期环境遗漏 202608090002 迁移时的写入失败。

alter table public.detection_analyses
  alter column sentiment_label drop not null,
  alter column sentiment_label drop default;

alter table public.detection_analyses
  drop constraint if exists detection_analyses_sentiment_label_check;

update public.detection_analyses
set sentiment_label = case sentiment_label
  when '正面' then '积极'
  when '负面' then '需改善'
  when '待确认' then null
  else sentiment_label
end
where sentiment_label in ('正面', '负面', '待确认');

alter table public.detection_analyses
  add constraint detection_analyses_sentiment_label_check
  check (sentiment_label is null or sentiment_label in ('积极', '中性', '需改善'));
