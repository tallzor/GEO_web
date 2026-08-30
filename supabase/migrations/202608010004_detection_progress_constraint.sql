-- completed_runs means processed steps and already includes failed steps.
-- Therefore failed_runs must be bounded by completed_runs rather than added to it.

alter table public.detections
  drop constraint if exists detections_check;

alter table public.detections
  add constraint detections_progress_is_consistent
  check (
    completed_runs <= total_runs
    and failed_runs <= completed_runs
  );
