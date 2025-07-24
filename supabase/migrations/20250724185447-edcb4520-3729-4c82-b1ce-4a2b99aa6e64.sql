-- Fix critical role escalation vulnerability
-- Remove dangerous policies that allow users to modify their own roles
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;

-- Create secure policies for user_roles table
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Only admins can insert roles" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can update roles" 
ON public.user_roles 
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admins can delete roles" 
ON public.user_roles 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Fix database function security issues
-- Update all functions to use proper search_path and security settings

CREATE OR REPLACE FUNCTION public.update_user_coinbase_connections_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  NEW.last_sync = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fetch_coinbase_connection_name(connection_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  -- This function will be called by edge functions to update connection names
  -- For now, return a placeholder that edge functions can update
  RETURN 'Coinbase Account';
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_mock_wallet_balances()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  -- This function will be called by the frontend to reset wallet balances
  -- Since we don't store wallet balances in the database directly,
  -- this is a placeholder that can be extended if needed
  
  -- Log the reset action
  RAISE NOTICE 'Mock wallet balances reset requested';
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_data_sources_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_price_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  -- Add price change calculations to metadata
  IF TG_OP = 'INSERT' THEN
    -- Calculate percentage change from open to close
    NEW.metadata = NEW.metadata || jsonb_build_object(
      'price_change_pct', 
      CASE 
        WHEN NEW.open_price > 0 THEN 
          ROUND(((NEW.close_price - NEW.open_price) / NEW.open_price * 100)::numeric, 2)
        ELSE 0 
      END,
      'price_range_pct',
      CASE 
        WHEN NEW.low_price > 0 THEN 
          ROUND(((NEW.high_price - NEW.low_price) / NEW.low_price * 100)::numeric, 2)
        ELSE 0 
      END
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_strategy_performance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  -- This will be called when mock trades are inserted/updated
  -- to automatically update strategy performance metrics
  INSERT INTO public.strategy_performance (
    strategy_id,
    user_id,
    execution_date,
    total_trades,
    winning_trades,
    losing_trades,
    total_profit_loss,
    total_fees,
    win_rate,
    is_test_mode
  )
  SELECT 
    NEW.strategy_id,
    NEW.user_id,
    CURRENT_DATE,
    COUNT(*),
    COUNT(*) FILTER (WHERE profit_loss > 0),
    COUNT(*) FILTER (WHERE profit_loss < 0),
    SUM(profit_loss),
    SUM(fees),
    CASE 
      WHEN COUNT(*) > 0 THEN 
        ROUND((COUNT(*) FILTER (WHERE profit_loss > 0))::NUMERIC / COUNT(*) * 100, 2)
      ELSE 0 
    END,
    NEW.is_test_mode
  FROM public.mock_trades 
  WHERE strategy_id = NEW.strategy_id 
    AND user_id = NEW.user_id
    AND DATE(executed_at) = CURRENT_DATE
  ON CONFLICT (strategy_id, execution_date) 
  DO UPDATE SET
    total_trades = EXCLUDED.total_trades,
    winning_trades = EXCLUDED.winning_trades,
    losing_trades = EXCLUDED.losing_trades,
    total_profit_loss = EXCLUDED.total_profit_loss,
    total_fees = EXCLUDED.total_fees,
    win_rate = EXCLUDED.win_rate,
    updated_at = now();
    
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN new;
END;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE 
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE 
 SECURITY DEFINER
 SET search_path = ''
AS $function$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  -- Assign 'user' role by default
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Check if this is the admin email and assign admin role
  IF NEW.raw_user_meta_data ->> 'email' = 'mon.petit.site.web@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- Add security logging for sensitive operations
CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  action_type text NOT NULL,
  table_name text,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view audit logs" 
ON public.security_audit_log 
FOR SELECT 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add audit trigger for user_roles changes
CREATE OR REPLACE FUNCTION public.audit_user_roles_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
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

CREATE TRIGGER audit_user_roles_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_roles_changes();