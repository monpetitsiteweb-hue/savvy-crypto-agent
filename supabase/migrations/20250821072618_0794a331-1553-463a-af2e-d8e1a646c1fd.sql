-- Fix all SECURITY DEFINER functions with empty search paths
-- These empty search paths are causing the "Security Definer View" linter errors

-- Fix audit_sensitive_data_access
CREATE OR REPLACE FUNCTION public.audit_sensitive_data_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
  -- Log access to sensitive trading data
  IF TG_OP = 'SELECT' AND auth.uid() IS NOT NULL THEN
    INSERT INTO public.security_audit_log (
      user_id, action_type, table_name, created_at
    ) VALUES (
      auth.uid(), 'SENSITIVE_DATA_ACCESS', TG_TABLE_NAME, now()
    );
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Fix audit_user_roles_changes  
CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'  -- Changed from empty string
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.security_audit_log (
      user_id, action_type, table_name, record_id, new_values
    ) VALUES (
      auth.uid(), 'INSERT', 'user_roles', NEW.id, to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.security_audit_log (
      user_id, action_type, table_name, record_id, old_values, new_values
    ) VALUES (
      auth.uid(), 'UPDATE', 'user_roles', NEW.id, to_jsonb(OLD), to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.security_audit_log (
      user_id, action_type, table_name, record_id, old_values
    ) VALUES (
      auth.uid(), 'DELETE', 'user_roles', OLD.id, to_jsonb(OLD)
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;