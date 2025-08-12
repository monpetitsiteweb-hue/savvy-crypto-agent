-- Fix Security Issue: Remove overly permissive view privileges
-- The security definer warning is caused by views having broad permissions

-- Revoke all permissions from public roles on views
REVOKE ALL ON public.past_positions_view FROM anon;
REVOKE ALL ON public.past_positions_view FROM authenticated;
REVOKE ALL ON public.past_positions_view FROM public;

REVOKE ALL ON public.past_positions_view_admin FROM anon;
REVOKE ALL ON public.past_positions_view_admin FROM authenticated;
REVOKE ALL ON public.past_positions_view_admin FROM public;

-- Grant only SELECT permission to authenticated users for regular view
GRANT SELECT ON public.past_positions_view TO authenticated;

-- The admin view should only be accessible to authenticated users
-- (RLS policies on the underlying table will handle admin access control)
GRANT SELECT ON public.past_positions_view_admin TO authenticated;

-- Ensure service_role retains full access for administrative functions
GRANT ALL ON public.past_positions_view TO service_role;
GRANT ALL ON public.past_positions_view_admin TO service_role;

-- Update comments for documentation
COMMENT ON VIEW public.past_positions_view IS 'User trading positions view - access controlled via RLS on underlying table and auth.uid() filter';
COMMENT ON VIEW public.past_positions_view_admin IS 'Admin trading positions view - access controlled via RLS policies requiring admin role';