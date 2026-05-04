-- 1) Reconstruire la paire SUBMITTED orpheline en REVERTED
UPDATE real_trades
SET 
  execution_status = 'REVERTED',
  receipt_status = false,
  block_number = 45610956,
  block_timestamp = to_timestamp(1777002107),  -- 0x69f8407b
  gas_used = 72463,
  error_reason = 'TRANSFER_FROM_FAILED (manually reconciled — onchain-receipts polling failed)',
  raw_receipt = jsonb_build_object(
    'status', '0x0',
    'blockNumber', '0x2b6f1cc',
    'gasUsed', '0x11b0f',
    'effectiveGasPrice', '0x5dd770',
    'transactionHash', '0xaacc3f324670e045f74a7926f8352f6dd0b26d47204f3ea188f70a46de538eb7',
    'manually_reconciled', true
  )
WHERE id = '14727029-85a8-443d-abe7-10a2ea1f74be'
  AND execution_status = 'SUBMITTED';

-- 2) DELETE des 302 orphelins purs (Carlos, BUY, LIVE, price=0, onchain_pending, sans real_trades lié)
DELETE FROM mock_trades mt
WHERE mt.user_id = '3a05bf2d-0a8c-4909-9e79-bed87e46270c'
  AND mt.trade_type = 'buy'
  AND mt.is_test_mode = false
  AND mt.execution_confirmed = false
  AND mt.execution_source = 'onchain_pending'
  AND mt.price = 0
  AND NOT EXISTS (
    SELECT 1 FROM real_trades rt WHERE rt.trade_id = mt.id
  );