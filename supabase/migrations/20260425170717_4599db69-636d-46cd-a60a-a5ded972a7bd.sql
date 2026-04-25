ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS soil_type text,
  ADD COLUMN IF NOT EXISTS soil_ph numeric(4,2),
  ADD COLUMN IF NOT EXISTS soil_organic_carbon numeric(6,2),
  ADD COLUMN IF NOT EXISTS soil_data_raw jsonb;