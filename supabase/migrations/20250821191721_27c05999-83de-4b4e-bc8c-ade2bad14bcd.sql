-- Fix security warning by explicitly setting security invoker
ALTER VIEW public.past_positions_view SET (security_invoker = on);