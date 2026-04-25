-- 1. sowing_date in parcels
ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS sowing_date date;

-- 2. extend phenophases with sowing-day windows + description
ALTER TABLE public.phenophases
  ADD COLUMN IF NOT EXISTS days_from_sowing_start integer,
  ADD COLUMN IF NOT EXISTS days_from_sowing_end integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_critical boolean NOT NULL DEFAULT false;

-- 3. parcel_growth table
CREATE TABLE IF NOT EXISTS public.parcel_growth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL REFERENCES public.parcels(id) ON DELETE CASCADE,
  current_phase_id uuid REFERENCES public.phenophases(id) ON DELETE SET NULL,
  is_manual_override boolean NOT NULL DEFAULT false,
  manual_override_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id)
);

ALTER TABLE public.parcel_growth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcel_growth_select_own"
  ON public.parcel_growth FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_growth.parcel_id AND p.user_id = auth.uid()));

CREATE POLICY "parcel_growth_insert_own"
  ON public.parcel_growth FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_growth.parcel_id AND p.user_id = auth.uid()));

CREATE POLICY "parcel_growth_update_own"
  ON public.parcel_growth FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_growth.parcel_id AND p.user_id = auth.uid()));

CREATE POLICY "parcel_growth_delete_own"
  ON public.parcel_growth FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_growth.parcel_id AND p.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_parcel_growth_parcel ON public.parcel_growth(parcel_id);
CREATE INDEX IF NOT EXISTS idx_phenophases_crop_window ON public.phenophases(crop_type, days_from_sowing_start);