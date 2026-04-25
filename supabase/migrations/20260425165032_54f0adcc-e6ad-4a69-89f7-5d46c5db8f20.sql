-- Add user_id to irrigation_events to support direct RLS on the table
-- (existing RLS uses a join through parcels; we keep both for safety).
ALTER TABLE public.irrigation_events
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Backfill user_id from the parent parcel.
UPDATE public.irrigation_events ie
SET user_id = p.user_id
FROM public.parcels p
WHERE ie.parcel_id = p.id AND ie.user_id IS NULL;

-- Trigger to auto-populate user_id on insert from the parcel's owner.
CREATE OR REPLACE FUNCTION public.set_irrigation_event_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    SELECT user_id INTO NEW.user_id FROM public.parcels WHERE id = NEW.parcel_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_irrigation_event_user_id ON public.irrigation_events;
CREATE TRIGGER trg_set_irrigation_event_user_id
  BEFORE INSERT ON public.irrigation_events
  FOR EACH ROW EXECUTE FUNCTION public.set_irrigation_event_user_id();

-- Re-attach the recalc trigger if it doesn't already exist on this table
-- (the trigger function trigger_recalc_recommendation already exists).
DROP TRIGGER IF EXISTS trg_recalc_after_irrigation ON public.irrigation_events;
CREATE TRIGGER trg_recalc_after_irrigation
  AFTER INSERT ON public.irrigation_events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_recalc_recommendation();