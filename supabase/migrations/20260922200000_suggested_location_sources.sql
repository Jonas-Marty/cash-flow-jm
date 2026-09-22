-- The suggested place is no longer history-sourced only.
--
-- It was, when the column was added: only a description match could produce
-- one, and the model was deliberately excluded because a label it invented
-- would have no coordinates and nothing could apply it.
--
-- That reasoning still holds, so the model is still never asked for a place.
-- What changed is that there are now three ways to find one, and all three end
-- at a row the user already stored: a description match, a proximity cluster of
-- their own past visits, or the model choosing among a shortlist of those
-- visits by reference. The coordinates always come from the server.
--
-- Comment-only: no column, constraint or data changes.

COMMENT ON COLUMN public.pending_transactions.suggested_location IS
  'Proposed location as a TxLocation object (latitude, longitude, accuracy_m, label, source). Always copied verbatim from one of the user''s own located transactions -- by description match, by proximity cluster, or by the model picking from a server-built shortlist by reference. The model never supplies a coordinate or a name.';

COMMENT ON COLUMN public.pending_transactions.suggestion_source IS
  'How the row''s suggestion was produced: ''history'' (the user''s own past entries or their own visited places) or ''ai''. Describes the row, not the place: an ''ai'' row may carry a place that geometry found.';
