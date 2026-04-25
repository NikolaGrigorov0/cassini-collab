ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS soil_type_wrb text,
  ADD COLUMN IF NOT EXISTS soil_type_bg text,
  ADD COLUMN IF NOT EXISTS soil_fc_pct numeric,
  ADD COLUMN IF NOT EXISTS soil_wp_pct numeric,
  ADD COLUMN IF NOT EXISTS soil_awc_pct numeric;