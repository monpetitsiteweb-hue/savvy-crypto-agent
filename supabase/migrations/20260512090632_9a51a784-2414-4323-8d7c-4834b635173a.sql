ALTER TABLE public.mock_trades
  ADD CONSTRAINT mock_trades_original_trade_id_fkey
  FOREIGN KEY (original_trade_id)
  REFERENCES public.mock_trades(id)
  ON DELETE RESTRICT
  NOT VALID;