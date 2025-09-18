-- Grant vault schema access to service_role for edge functions
create extension if not exists supabase_vault;

grant usage on schema vault to service_role;
grant select on table vault.decrypted_secrets to service_role;