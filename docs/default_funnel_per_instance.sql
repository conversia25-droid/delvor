-- Default funnel per WhatsApp instance
-- This makes every NEW lead created with send_instance_key automatically enter the funnel configured on that instance.
-- IMPORTANT: Review table/column names to match your schema before running.

-- 1) Add column to instancias (if it doesn't exist)
ALTER TABLE public.instancias
ADD COLUMN IF NOT EXISTS default_funnel_id uuid NULL;

-- 2) Helper: get first stage of a funnel
CREATE OR REPLACE FUNCTION public._first_stage_id(p_funnel_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM public.funnel_stages
  WHERE funnel_id = p_funnel_id
  ORDER BY stage_order ASC
  LIMIT 1
$$;

-- 3) Trigger function: assign funnel/stage on lead insert
CREATE OR REPLACE FUNCTION public._assign_default_funnel_on_lead_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_funnel_id uuid;
  v_stage_id uuid;
BEGIN
  -- only when not set yet
  IF NEW.current_funnel_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- requires the lead to carry the instance key (send_instance_key)
  IF NEW.send_instance_key IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.default_funnel_id
    INTO v_funnel_id
  FROM public.instancias i
  WHERE i.company_id = NEW.company_id
    AND i.instance_key = NEW.send_instance_key
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_stage_id := public._first_stage_id(v_funnel_id);

  NEW.current_funnel_id := v_funnel_id;
  IF NEW.current_stage_id IS NULL THEN
    NEW.current_stage_id := v_stage_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_default_funnel_on_lead_insert ON public.leads;

CREATE TRIGGER trg_assign_default_funnel_on_lead_insert
BEFORE INSERT ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public._assign_default_funnel_on_lead_insert();
