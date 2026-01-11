-- Update handle_new_user to also create user_onboarding_status row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Idempotent profile creation
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  -- Idempotent role assignment (default: 'user')
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- Idempotent onboarding status (default: 'welcome')
  INSERT INTO public.user_onboarding_status (user_id, current_step)
  VALUES (new.id, 'welcome')
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;