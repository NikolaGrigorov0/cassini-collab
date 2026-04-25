
ALTER TABLE public.irrigation_events
  ADD COLUMN IF NOT EXISTS dose_mm numeric(6,2),
  ADD COLUMN IF NOT EXISTS ndmi_before numeric(5,4),
  ADD COLUMN IF NOT EXISTS ndmi_after numeric(5,4),
  ADD COLUMN IF NOT EXISTS status_before text,
  ADD COLUMN IF NOT EXISTS status_after text,
  ADD COLUMN IF NOT EXISTS original_dose_mm numeric(6,2),
  ADD COLUMN IF NOT EXISTS irrigated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS undone boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS undone_at timestamptz;

CREATE INDEX IF NOT EXISTS irrigation_events_parcel_undone_idx
  ON public.irrigation_events (parcel_id, undone, created_at DESC);
