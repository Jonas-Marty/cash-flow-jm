
-- Enum for link kind (drives icon only)
DO $$ BEGIN
  CREATE TYPE public.transaction_link_kind AS ENUM ('purchase', 'event', 'trip', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1. transaction_links
CREATE TABLE public.transaction_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT,
  kind public.transaction_link_kind NOT NULL DEFAULT 'purchase',
  planned_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_links TO authenticated;
GRANT ALL ON public.transaction_links TO service_role;

ALTER TABLE public.transaction_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own transaction links"
  ON public.transaction_links
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX transaction_links_user_id_idx ON public.transaction_links(user_id);

CREATE TRIGGER update_transaction_links_updated_at
  BEFORE UPDATE ON public.transaction_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. transaction_link_members (transaction belongs to at most one link)
CREATE TABLE public.transaction_link_members (
  transaction_id UUID NOT NULL PRIMARY KEY REFERENCES public.transactions(id) ON DELETE CASCADE,
  link_id UUID NOT NULL REFERENCES public.transaction_links(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_link_members TO authenticated;
GRANT ALL ON public.transaction_link_members TO service_role;

ALTER TABLE public.transaction_link_members ENABLE ROW LEVEL SECURITY;

-- Membership rows are visible/mutable only when both the link and the transaction belong to the caller.
CREATE POLICY "Users view their own link members"
  ON public.transaction_link_members
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.transaction_links l WHERE l.id = link_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
  );

CREATE POLICY "Users insert their own link members"
  ON public.transaction_link_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.transaction_links l WHERE l.id = link_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
  );

CREATE POLICY "Users update their own link members"
  ON public.transaction_link_members
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.transaction_links l WHERE l.id = link_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.transaction_links l WHERE l.id = link_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
  );

CREATE POLICY "Users delete their own link members"
  ON public.transaction_link_members
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.transaction_links l WHERE l.id = link_id AND l.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_id AND t.user_id = auth.uid())
  );

CREATE INDEX transaction_link_members_link_id_idx ON public.transaction_link_members(link_id);
