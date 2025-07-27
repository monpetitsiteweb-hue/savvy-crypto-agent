-- Fix ALL trades to use correct user_id
UPDATE mock_trades 
SET user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
WHERE user_id IN ('b58753c0-e516-44de-9427-c73773f59310', 'cf4252a5-5aee-473d-bdbc-44a2e992ec6f');