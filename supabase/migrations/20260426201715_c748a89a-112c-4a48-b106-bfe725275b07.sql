UPDATE public.trading_strategies
SET is_active = false,
    state = 'PAUSED',
    updated_at = now()
WHERE id = '6c1180fb-4f56-4a98-8908-57012414ae66';