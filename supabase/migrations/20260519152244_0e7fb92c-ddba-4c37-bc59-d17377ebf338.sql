UPDATE mock_trades
SET amount = 0.00469447,
    price = 1829.81,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_fix'
WHERE id = 'cf1408bc-1e56-472a-9cc4-144cd697e9f4'
  AND amount <> 0.00469447;

UPDATE mock_trades
SET amount = 0.00470799,
    price = 1824.56,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_fix'
WHERE id = '3c70f2f4-fb32-414e-9dec-36fade60e675'
  AND amount <> 0.00470799;

UPDATE mock_trades
SET amount = 0.00436409,
    price = 1947.72,
    notes = COALESCE(notes, '') || ' | reconstructed_2026-05-19_post_b18_fix'
WHERE id = '04d5d327-9776-4fc8-a05c-21f495563320'
  AND amount <> 0.00436409;