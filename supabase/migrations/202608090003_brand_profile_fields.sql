alter table public.brands
  add column if not exists short_name text,
  add column if not exists characteristics text,
  add column if not exists category_name text,
  add column if not exists trust_proof text,
  add column if not exists positioning_statement text;

notify pgrst, 'reload schema';
