ALTER TABLE public.decision_snapshots ADD COLUMN IF NOT EXISTS snapshot_type TEXT DEFAULT NULL;

COMMENT ON COLUMN public.decision_snapshots.snapshot_type IS 'ENTRY or EXIT — distinguishes entry decisions (coordinator fusion) from exit decisions (category scoring for runner logic)';