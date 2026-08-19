-- Self-hosted parity: create the private statement-files bucket.
-- (On Lovable Cloud the bucket is created through the storage API; this is a no-op there.)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('statement-files', 'statement-files', false, 26214400)
ON CONFLICT (id) DO NOTHING;
