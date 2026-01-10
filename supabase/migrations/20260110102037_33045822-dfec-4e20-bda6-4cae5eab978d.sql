-- Remove the redundant trigger and function that causes duplicate key errors
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user_role();