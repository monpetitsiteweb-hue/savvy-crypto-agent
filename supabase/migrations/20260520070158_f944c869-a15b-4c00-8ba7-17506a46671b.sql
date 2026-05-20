-- CAS 1 — SELL isolé 2026-05-19 02:55:06
UPDATE mock_trades
SET 
  price = 1949.03,
  total_value = 9.16,
  realized_pnl = 0.57,
  notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = '75b78575-a32f-4351-b856-5e7c71c78751'
  AND price <> 1949.03;

-- CAS 2 — Cluster 6 SELLs fan-out 2026-05-04 15:14:28
UPDATE mock_trades
SET price = 2168.99, total_value = 9.25, realized_pnl = 0.70,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = '4f8ac92d-c74b-4ed9-8b92-d38de8a9aefb' AND price <> 2168.99;

UPDATE mock_trades
SET price = 2168.99, total_value = 9.27, realized_pnl = 0.72,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = '90e9dd85-a6c2-476d-aaaf-f6b97a9d8956' AND price <> 2168.99;

UPDATE mock_trades
SET price = 2168.99, total_value = 9.26, realized_pnl = 0.71,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = '900933a1-f3c7-44d7-8252-2c419bae3217' AND price <> 2168.99;

UPDATE mock_trades
SET price = 2168.99, total_value = 9.26, realized_pnl = 0.71,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = 'ba9c3143-ec64-4545-ad91-926b3fd316ff' AND price <> 2168.99;

UPDATE mock_trades
SET price = 2168.99, total_value = 9.28, realized_pnl = 0.73,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = 'b045e4a4-0447-4999-9fe9-a72abcf3a697' AND price <> 2168.99;

UPDATE mock_trades
SET price = 2168.99, total_value = 9.28, realized_pnl = 0.73,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_sell_fix'
WHERE id = 'ddce5a5b-1ec2-4f49-8c50-e24e1b291aa9' AND price <> 2168.99;