-- Clean up profiles for anonymous users that are showing as "Unknown User" in the admin panel
DELETE FROM public.profiles 
WHERE id IN (
  SELECT p.id 
  FROM public.profiles p 
  JOIN auth.users u ON p.id = u.id 
  WHERE u.is_anonymous = true
);