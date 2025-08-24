-- CRITICAL FIX: Delete all signals with wrong user IDs and regenerate with correct user IDs
DELETE FROM live_signals WHERE user_id != '25a0c221-1f0e-431d-8d79-db9fb4db9cb3';