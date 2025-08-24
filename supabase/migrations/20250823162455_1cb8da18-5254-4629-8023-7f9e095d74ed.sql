-- Fix pgcrypto extension security warning by using digest function directly
-- We don't actually need pgcrypto for our advisory lock hash since we can use PostgreSQL's built-in hashtext function
-- Remove the extension since it was added to public schema
DROP EXTENSION IF EXISTS pgcrypto;