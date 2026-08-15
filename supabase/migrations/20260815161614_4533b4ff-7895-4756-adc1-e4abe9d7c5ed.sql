DELETE FROM public.settings s
USING (
  SELECT user_id, MIN(created_at) AS keep_created
  FROM public.settings
  WHERE user_id IS NOT NULL
  GROUP BY user_id
) k
WHERE s.user_id = k.user_id AND s.created_at > k.keep_created;

CREATE UNIQUE INDEX IF NOT EXISTS settings_user_id_key ON public.settings(user_id);