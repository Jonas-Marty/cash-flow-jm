CREATE OR REPLACE FUNCTION public.sync_transaction_tags()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE m TEXT;
BEGIN
  DELETE FROM public.transaction_tags WHERE transaction_id = NEW.id;
  IF NEW.note IS NOT NULL THEN
    FOR m IN SELECT DISTINCT lower(x[1]) FROM regexp_matches(NEW.note, '#([A-Za-z0-9_]+)', 'g') AS x LOOP
      INSERT INTO public.transaction_tags(transaction_id, tag) VALUES (NEW.id, m) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END; $function$;

-- Backfill: re-sync all existing transaction tags using corrected logic
DELETE FROM public.transaction_tags;
INSERT INTO public.transaction_tags (transaction_id, tag)
SELECT DISTINCT t.id, lower(x[1])
FROM public.transactions t,
     LATERAL regexp_matches(coalesce(t.note,''), '#([A-Za-z0-9_]+)', 'g') AS x
ON CONFLICT DO NOTHING;