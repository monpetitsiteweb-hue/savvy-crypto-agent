-- Fix RLS policies on ai_data_sources to allow admins to see all sources

-- Drop existing policy
DROP POLICY IF EXISTS "Users can manage their own data sources" ON public.ai_data_sources;

-- Create separate policies for each operation
-- SELECT: Users see their own sources, admins see everything
CREATE POLICY "Users and admins can view data sources"
ON public.ai_data_sources
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id 
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- INSERT: Users can insert their own sources, admins can insert any
CREATE POLICY "Users and admins can insert data sources"
ON public.ai_data_sources
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- UPDATE: Users can update their own sources, admins can update any
CREATE POLICY "Users and admins can update data sources"
ON public.ai_data_sources
FOR UPDATE
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);

-- DELETE: Users can delete their own sources, admins can delete any
CREATE POLICY "Users and admins can delete data sources"
ON public.ai_data_sources
FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
    AND ur.role = 'admin'
  )
);