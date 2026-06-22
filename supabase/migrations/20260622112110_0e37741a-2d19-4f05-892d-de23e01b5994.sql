-- Allow unicode letters (umlauts, accents) in hashtag extraction.
-- POSIX char classes [:alnum:] respect the database's UTF-8 locale, matching
-- the JS extractor /#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/u.
CREATE OR REPLACE FUNCTION public.sync_transaction_tags()
RETURNS TRIGGER AS $$
DECLARE
  m TEXT;
BEGIN
  DELETE FROM public.transaction_tags WHERE transaction_id = NEW.id;
  IF NEW.note IS NOT NULL THEN
    FOR m IN
      SELECT DISTINCT lower(x[1])
      FROM regexp_matches(NEW.note, '#([[:alnum:]_][[:alnum:]_-]*)', 'g') AS x
    LOOP
      INSERT INTO public.transaction_tags(transaction_id, tag)
      VALUES (NEW.id, m) ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Re-index all existing transaction notes with the new pattern.
DELETE FROM public.transaction_tags;
INSERT INTO public.transaction_tags (transaction_id, tag)
SELECT DISTINCT t.id, lower(x[1])
FROM public.transactions t,
     LATERAL regexp_matches(coalesce(t.note,''), '#([[:alnum:]_][[:alnum:]_-]*)', 'g') AS x
ON CONFLICT DO NOTHING;
