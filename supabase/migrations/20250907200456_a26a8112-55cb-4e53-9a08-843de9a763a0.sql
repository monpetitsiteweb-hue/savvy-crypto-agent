create or replace view vw_trade_decision_linkage_60m as
with decisions as (
  select
    user_id,
    created_at,
    symbol,
    intent_side,
    metadata->>'request_id' as request_id
  from trade_decisions_log
  where created_at > now() - interval '60 minutes'
    and decision_action in ('ENTER','EXIT')
),
trades as (
  select
    user_id,
    executed_at,
    trade_type,
    cryptocurrency,
    strategy_trigger
  from mock_trades
  where is_test_mode = true
    and executed_at > now() - interval '60 minutes'
)
select
  t.user_id,
  t.executed_at,
  t.trade_type,
  t.cryptocurrency,
  t.strategy_trigger,
  d.created_at as decision_time,
  d.intent_side,
  d.request_id,
  extract(epoch from (t.executed_at - d.created_at))::int as seconds_apart
from trades t
left join lateral (
  select *
  from decisions d
  where d.user_id = t.user_id
    and d.symbol = t.cryptocurrency
    and (
      (t.trade_type = 'buy'  and d.intent_side = 'BUY') or
      (t.trade_type = 'sell' and d.intent_side = 'SELL')
    )
    and d.created_at <= t.executed_at
    and t.executed_at - d.created_at <= interval '2 minutes'
  order by d.created_at desc
  limit 1
) d on true
order by t.executed_at asc;