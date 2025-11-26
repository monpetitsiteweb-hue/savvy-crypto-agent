-- Fix RLS policies on ai_data_sources (final correct version)
-- System sources have user_id IS NULL
-- Users see their own sources + system sources
-- Admins see everything

-- Drop existing policies
DROP POLICY IF EXISTS "Users and admins can view data sources" ON public.ai_data_sources;
DROP POLICY IF EXISTS "Users and admins can insert data sources" ON public.ai_data_sources;
DROP POLICY IF EXISTS "Users and admins can update data sources" ON public.ai_data_sources;
DROP POLICY IF EXISTS "Users and admins can delete data sources" ON public.ai_data_sources;

-- SELECT: Users see own + system sources, admins see all
CREATE POLICY "view data sources"
ON public.ai_data_sources
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR user_id IS NULL
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- INSERT: Users can insert own sources, admins can insert any
CREATE POLICY "insert own data sources"
ON public.ai_data_sources
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- UPDATE: Users can update own sources, admins can update any
CREATE POLICY "update data sources"
ON public.ai_data_sources
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- DELETE: Users can delete own sources, admins can delete any
CREATE POLICY "delete data sources"
ON public.ai_data_sources
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);