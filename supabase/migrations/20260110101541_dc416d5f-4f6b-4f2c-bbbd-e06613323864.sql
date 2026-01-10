-- Update handle_new_user to be fully idempotent (canonical onboarding trigger)
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

  RETURN new;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Canonical onboarding trigger. Handles profile + role creation idempotently. Do NOT create parallel triggers on auth.users.';