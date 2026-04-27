-- Fix tag extraction: previously stripped first char of each tag.
CREATE OR REPLACE FUNCTION public.sync_transaction_tags()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE m TEXT;
BEGIN
  DELETE FROM public.transaction_tags WHERE transaction_id = NEW.id;
  IF NEW.note IS NOT NULL THEN
    FOR m IN SELECT DISTINCT lower(x[1]) FROM regexp_matches(NEW.note, '#([A-Za-z0-9_]+)', 'g') AS x LOOP
      INSERT INTO public.transaction_tags(transaction_id, tag) VALUES (NEW.id, m) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$;

-- Re-sync existing tags for all transactions that have a note with hashtags.
DELETE FROM public.transaction_tags
WHERE transaction_id IN (SELECT id FROM public.transactions WHERE note ~ '#[A-Za-z0-9_]+');

INSERT INTO public.transaction_tags (transaction_id, tag)
SELECT t.id, lower(x[1])
FROM public.transactions t,
     LATERAL regexp_matches(t.note, '#([A-Za-z0-9_]+)', 'g') AS x
WHERE t.note IS NOT NULL
ON CONFLICT DO NOTHING;
