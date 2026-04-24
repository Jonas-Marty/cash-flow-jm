ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS day_heatmap_threshold numeric NOT NULL DEFAULT 100;