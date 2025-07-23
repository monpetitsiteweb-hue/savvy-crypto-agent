-- Fix function search path security warnings
ALTER FUNCTION public.calculate_price_changes() SET search_path = public;