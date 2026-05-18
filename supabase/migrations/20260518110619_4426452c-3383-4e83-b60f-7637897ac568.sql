-- Make transaction_attachments polymorphic so statements can have attachments too.
ALTER TABLE public.transaction_attachments
  ALTER COLUMN transaction_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS statement_id uuid;

-- Exactly one parent must be set.
ALTER TABLE public.transaction_attachments
  DROP CONSTRAINT IF EXISTS attachments_one_parent;
ALTER TABLE public.transaction_attachments
  ADD CONSTRAINT attachments_one_parent
  CHECK (
    (transaction_id IS NOT NULL)::int + (statement_id IS NOT NULL)::int = 1
  );

CREATE INDEX IF NOT EXISTS idx_transaction_attachments_statement
  ON public.transaction_attachments (statement_id);

-- Update RLS to allow access via either parent.
DROP POLICY IF EXISTS "own attachments" ON public.transaction_attachments;
CREATE POLICY "own attachments"
  ON public.transaction_attachments
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
