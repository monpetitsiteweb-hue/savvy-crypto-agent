-- Fix strategy and trades to use correct user_id
UPDATE trading_strategies 
SET user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
WHERE strategy_name = 'XRP Buy on Bitcoin Drop with Bullish Sentiment'
   AND user_id = 'b58753c0-e516-44de-9427-c73773f59310';

UPDATE mock_trades 
SET user_id = '25a0c221-1f0e-431d-8d79-db9fb4db9cb3'
WHERE strategy_id = '406cbb65-be0f-4ca3-a7fc-df0b2fa0b10a'
   AND user_id = 'b58753c0-e516-44de-9427-c73773f59310';