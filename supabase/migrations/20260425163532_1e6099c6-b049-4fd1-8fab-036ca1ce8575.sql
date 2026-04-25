
-- AquaDose schema
CREATE TABLE public.parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  crop_type TEXT NOT NULL CHECK (crop_type IN ('wheat','corn','tomatoes','sunflower','vineyard')),
  growth_phase TEXT NOT NULL CHECK (growth_phase IN ('initial','development','mid','late')),
  area_hectares NUMERIC NOT NULL,
  geometry TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ndmi_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID NOT NULL REFERENCES public.parcels(id) ON DELETE CASCADE,
  ndmi_value NUMERIC NOT NULL,
  ndvi_value NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'sentinel-2'
);

CREATE TABLE public.irrigation_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id UUID NOT NULL REFERENCES public.parcels(id) ON DELETE CASCADE,
  dose_mm NUMERIC NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('green','yellow','red')),
  reason TEXT NOT NULL,
  valid_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ndmi_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.irrigation_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcels_select_own" ON public.parcels FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "parcels_insert_own" ON public.parcels FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "parcels_update_own" ON public.parcels FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "parcels_delete_own" ON public.parcels FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "ndmi_select_own" ON public.ndmi_readings FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid()));
CREATE POLICY "ndmi_insert_own" ON public.ndmi_readings FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid()));

CREATE POLICY "rec_select_own" ON public.irrigation_recommendations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid()));
CREATE POLICY "rec_insert_own" ON public.irrigation_recommendations FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid()));

CREATE INDEX idx_parcels_user ON public.parcels(user_id);
CREATE INDEX idx_ndmi_parcel ON public.ndmi_readings(parcel_id, recorded_at DESC);
CREATE INDEX idx_rec_parcel ON public.irrigation_recommendations(parcel_id, created_at DESC);

ALTER TABLE public.irrigation_recommendations
  ADD COLUMN IF NOT EXISTS forecast_json jsonb;

ALTER TABLE public.irrigation_recommendations REPLICA IDENTITY FULL;
ALTER TABLE public.ndmi_readings REPLICA IDENTITY FULL;
ALTER TABLE public.parcels REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.irrigation_recommendations;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.ndmi_readings;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.parcels;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER TABLE public.ndmi_readings
  ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'sentinel-2',
  ADD COLUMN IF NOT EXISTS confidence_pct integer DEFAULT 90,
  ADD COLUMN IF NOT EXISTS cloud_coverage numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rainfall_mm numeric(6,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eto_value numeric(5,2);

ALTER TABLE public.irrigation_recommendations
  ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'sentinel-2',
  ADD COLUMN IF NOT EXISTS confidence_pct integer DEFAULT 90;

CREATE TABLE public.water_deficit_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  available_pct integer NOT NULL CHECK (available_pct BETWEEN 1 AND 99),
  date_from date NOT NULL,
  date_to date NOT NULL,
  affected_parcels uuid[] DEFAULT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.deficit_schedules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  deficit_period_id uuid REFERENCES public.water_deficit_periods ON DELETE CASCADE NOT NULL,
  parcel_id uuid REFERENCES public.parcels ON DELETE CASCADE NOT NULL,
  scheduled_date date NOT NULL,
  dose_mm numeric(6,2) NOT NULL,
  priority text CHECK (priority IN ('critical','important','tolerable')),
  crop_stress_risk text CHECK (crop_stress_risk IN ('low','medium','high','critical')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.water_deficit_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deficit_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deficit_periods_select_own" ON public.water_deficit_periods FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "deficit_periods_insert_own" ON public.water_deficit_periods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "deficit_periods_update_own" ON public.water_deficit_periods FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "deficit_periods_delete_own" ON public.water_deficit_periods FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "deficit_schedules_select_own" ON public.deficit_schedules FOR SELECT
  USING (deficit_period_id IN (SELECT id FROM public.water_deficit_periods WHERE user_id = auth.uid()));
CREATE POLICY "deficit_schedules_insert_own" ON public.deficit_schedules FOR INSERT
  WITH CHECK (deficit_period_id IN (SELECT id FROM public.water_deficit_periods WHERE user_id = auth.uid()));
CREATE POLICY "deficit_schedules_update_own" ON public.deficit_schedules FOR UPDATE
  USING (deficit_period_id IN (SELECT id FROM public.water_deficit_periods WHERE user_id = auth.uid()));
CREATE POLICY "deficit_schedules_delete_own" ON public.deficit_schedules FOR DELETE
  USING (deficit_period_id IN (SELECT id FROM public.water_deficit_periods WHERE user_id = auth.uid()));

CREATE INDEX idx_deficit_periods_user ON public.water_deficit_periods(user_id);
CREATE INDEX idx_deficit_schedules_period ON public.deficit_schedules(deficit_period_id);
CREATE INDEX idx_deficit_schedules_parcel_date ON public.deficit_schedules(parcel_id, scheduled_date);

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.water_deficit_periods;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.deficit_schedules;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.water_deficit_periods REPLICA IDENTITY FULL;
ALTER TABLE public.deficit_schedules REPLICA IDENTITY FULL;

ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS pump_flow_m3h numeric;
COMMENT ON COLUMN public.parcels.pump_flow_m3h IS 'Pump flow rate in m³/hour, used to estimate irrigation runtime';

CREATE TABLE public.phenophases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_type text NOT NULL,
  phase_name text NOT NULL,
  order_index integer NOT NULL,
  typical_duration_days integer NOT NULL,
  kc_base numeric NOT NULL,
  mad_threshold numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (crop_type, order_index)
);
ALTER TABLE public.phenophases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "phenophases_select_all" ON public.phenophases FOR SELECT TO authenticated USING (true);

CREATE TABLE public.crop_growth_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  phase_id uuid REFERENCES public.phenophases(id),
  gdd_cumulative numeric DEFAULT 0,
  ndvi_value numeric,
  kc_adjusted numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crop_growth_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "growth_select_own" ON public.crop_growth_log FOR SELECT USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "growth_insert_own" ON public.crop_growth_log FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "growth_update_own" ON public.crop_growth_log FOR UPDATE USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "growth_delete_own" ON public.crop_growth_log FOR DELETE USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);

CREATE TABLE public.irrigation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount_mm numeric NOT NULL,
  method text NOT NULL DEFAULT 'manual',
  soil_moisture_after numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.irrigation_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "irrig_select_own" ON public.irrigation_events FOR SELECT USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "irrig_insert_own" ON public.irrigation_events FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "irrig_update_own" ON public.irrigation_events FOR UPDATE USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "irrig_delete_own" ON public.irrigation_events FOR DELETE USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);

CREATE TABLE public.soil_moisture_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parcel_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  moisture_pct numeric,
  et_mm numeric,
  rain_mm numeric,
  balance_mm numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parcel_id, date)
);
ALTER TABLE public.soil_moisture_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sm_select_own" ON public.soil_moisture_daily FOR SELECT USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "sm_insert_own" ON public.soil_moisture_daily FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);
CREATE POLICY "sm_update_own" ON public.soil_moisture_daily FOR UPDATE USING (
  EXISTS (SELECT 1 FROM parcels p WHERE p.id = parcel_id AND p.user_id = auth.uid())
);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'info',
  parcel_id uuid,
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_select_own" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notif_insert_own" ON public.notifications FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notif_update_own" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notif_delete_own" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_notif_user_unread ON public.notifications(user_id, read_at) WHERE read_at IS NULL;

ALTER TABLE public.parcels
  ADD COLUMN IF NOT EXISTS soil_sand_pct numeric,
  ADD COLUMN IF NOT EXISTS soil_clay_pct numeric,
  ADD COLUMN IF NOT EXISTS soil_silt_pct numeric,
  ADD COLUMN IF NOT EXISTS awc_mm numeric,
  ADD COLUMN IF NOT EXISTS slope_deg numeric,
  ADD COLUMN IF NOT EXISTS aspect_deg numeric,
  ADD COLUMN IF NOT EXISTS elevation_m numeric,
  ADD COLUMN IF NOT EXISTS soil_enriched_at timestamptz;

INSERT INTO public.phenophases (crop_type, phase_name, order_index, typical_duration_days, kc_base, mad_threshold) VALUES
('wheat', 'Поникване', 1, 15, 0.40, 0.55),
('wheat', 'Братене', 2, 30, 0.70, 0.55),
('wheat', 'Вретенене', 3, 25, 1.05, 0.50),
('wheat', 'Изкласяване', 4, 20, 1.15, 0.45),
('wheat', 'Наливане на зърното', 5, 25, 1.10, 0.45),
('wheat', 'Узряване', 6, 20, 0.40, 0.60),
('corn', 'Поникване', 1, 12, 0.30, 0.55),
('corn', 'Вегетативен растеж', 2, 35, 0.70, 0.50),
('corn', 'Изметляване', 3, 15, 1.05, 0.45),
('corn', 'Наливане на зърното', 4, 40, 1.20, 0.45),
('corn', 'Узряване', 5, 25, 0.60, 0.55),
('sunflower', 'Поникване', 1, 12, 0.35, 0.55),
('sunflower', 'Вегетативен растеж', 2, 35, 0.75, 0.50),
('sunflower', 'Цъфтеж', 3, 25, 1.15, 0.45),
('sunflower', 'Наливане на семената', 4, 30, 1.00, 0.50),
('sunflower', 'Узряване', 5, 20, 0.50, 0.55),
('tomato', 'Разсад', 1, 20, 0.60, 0.50),
('tomato', 'Вегетативен растеж', 2, 30, 0.80, 0.45),
('tomato', 'Цъфтеж', 3, 25, 1.15, 0.40),
('tomato', 'Наливане на плодовете', 4, 35, 1.25, 0.40),
('tomato', 'Узряване', 5, 25, 0.85, 0.50),
('vine', 'Разпукване на пъпките', 1, 20, 0.30, 0.55),
('vine', 'Цъфтеж', 2, 15, 0.50, 0.50),
('vine', 'Завръзване', 3, 30, 0.70, 0.45),
('vine', 'Зреене', 4, 50, 0.85, 0.45),
('vine', 'Беритба', 5, 20, 0.45, 0.55);

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_recalc_recommendation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://project--573787d3-699d-4965-9a0a-62886bfbf97a.lovable.app/api/public/hooks/recalc-parcel';
  v_reason text;
BEGIN
  v_reason := CASE NEW.method
    WHEN 'rain' THEN format('регистриран валеж %s mm', NEW.amount_mm)
    WHEN 'manual' THEN format('напояване %s mm', NEW.amount_mm)
    ELSE format('%s събитие %s mm', NEW.method, NEW.amount_mm)
  END;

  PERFORM net.http_post(
    url := v_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'parcel_id', NEW.parcel_id::text,
      'reason', v_reason
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS irrigation_events_recalc ON public.irrigation_events;
CREATE TRIGGER irrigation_events_recalc
AFTER INSERT ON public.irrigation_events
FOR EACH ROW
EXECUTE FUNCTION public.trigger_recalc_recommendation();

CREATE TABLE public.parcel_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parcel_id UUID NOT NULL,
  changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  changed_by UUID,
  old_geometry TEXT NOT NULL,
  new_geometry TEXT NOT NULL,
  old_area_ha NUMERIC NOT NULL,
  new_area_ha NUMERIC NOT NULL
);

CREATE INDEX idx_parcel_history_parcel_id ON public.parcel_history(parcel_id, changed_at DESC);

ALTER TABLE public.parcel_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parcel_history_select_own" ON public.parcel_history FOR SELECT
USING (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_history.parcel_id AND p.user_id = auth.uid()));

CREATE POLICY "parcel_history_insert_own" ON public.parcel_history FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.parcels p WHERE p.id = parcel_history.parcel_id AND p.user_id = auth.uid()));
