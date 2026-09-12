-- ============================================================================
-- SmartPR Enterprise — Phase 8: brand-assets storage bucket
--
-- Private bucket for white-label logo assets (primary/compact/favicon).
-- Object layout: {workspace_id}/{kind}-{timestamp}.{ext}
-- RLS: only members of the workspace that owns the folder may read/write.
-- Idempotent: safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets(id, name, public, file_size_limit)
      VALUES ('brand-assets', 'brand-assets', false, 2097152)
      ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 2097152;

    -- One policy covering all operations for workspace members. Folder segment
    -- [1] is the workspace id; members of that workspace may manage objects
    -- inside its folder. Server routes additionally enforce the
    -- configure_branding_security enterprise permission before uploading.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'Brand assets: workspace members only'
    ) THEN
      EXECUTE $policy$
        CREATE POLICY "Brand assets: workspace members only" ON storage.objects
        FOR ALL TO authenticated
        USING (
          bucket_id = 'brand-assets'
          AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
          AND EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = (storage.foldername(name))[1]::uuid
              AND wm.user_id = auth.uid()
          )
        )
        WITH CHECK (
          bucket_id = 'brand-assets'
          AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
          AND EXISTS (
            SELECT 1 FROM public.workspace_members wm
            WHERE wm.workspace_id = (storage.foldername(name))[1]::uuid
              AND wm.user_id = auth.uid()
          )
        )
      $policy$;
    END IF;
  END IF;
END $$;
