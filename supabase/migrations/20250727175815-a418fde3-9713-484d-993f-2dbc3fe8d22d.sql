-- Delete non-admin users from profiles and user_roles tables
-- Keep only the admin user: 25a0c221-1f0e-431d-8d79-db9fb4db9cb3

DELETE FROM profiles 
WHERE id NOT IN ('25a0c221-1f0e-431d-8d79-db9fb4db9cb3');

DELETE FROM user_roles 
WHERE user_id NOT IN ('25a0c221-1f0e-431d-8d79-db9fb4db9cb3');