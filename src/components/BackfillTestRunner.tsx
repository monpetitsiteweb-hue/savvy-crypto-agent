import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';

export const BackfillTestRunner = () => {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runFullTest = async () => {
    setLoading(true);
    setResults(null);
    
    try {
      const testResults: any = {};

      // 1. Run backfill function
      console.log('🔄 Running backfill function...');
      const { data: backfillData, error: backfillError } = await supabase.functions.invoke('backfill-sell-snapshots', {
        body: {
          scope: 'single_user',
          userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
          mode: 'test',
          dryRun: false
        }
      });
      
      testResults.backfill = backfillError ? { error: backfillError } : backfillData;

      // 2. Validation queries - we'll do these manually via console
      console.log('Run validation queries manually in Supabase SQL editor');
      testResults.validation_note = 'Run validation queries manually';

      const { data: pastCount } = await supabase.from('past_positions_view').select('*', { count: 'exact', head: true });
      testResults.past_positions_count = pastCount;

      const { data: pastSample } = await supabase
        .from('past_positions_view')
        .select('*')
        .order('exit_at', { ascending: false })
        .limit(10);
      testResults.past_positions_sample = pastSample;

      // 3. Create test sequences
      console.log('🔄 Creating test sequences...');
      
      // Sequence A: COINBASE_PRO (0% fees)
      const strategyA = crypto.randomUUID();
      const { data: buyA } = await supabase.from('mock_trades').insert({
        user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        strategy_id: strategyA,
        trade_type: 'buy',
        cryptocurrency: 'XRP-EUR',
        amount: 100,
        price: 0.50,
        total_value: 50.00,
        fees: 0.00,
        executed_at: new Date(Date.now() - 60000).toISOString(),
        is_test_mode: true
      }).select().single();

      const { data: sellA } = await supabase.from('mock_trades').insert({
        user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        strategy_id: strategyA,
        trade_type: 'sell',
        cryptocurrency: 'XRP-EUR',
        amount: 100,
        price: 0.55,
        total_value: 55.00,
        fees: 0.00,
        executed_at: new Date().toISOString(),
        is_test_mode: true
      }).select().single();

      // Sequence B: OTHER (5% fees)
      const strategyB = crypto.randomUUID();
      const { data: buyB } = await supabase.from('mock_trades').insert({
        user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        strategy_id: strategyB,
        trade_type: 'buy',
        cryptocurrency: 'ETH-EUR',
        amount: 0.1,
        price: 2000,
        total_value: 200.00,
        fees: 10.00,
        executed_at: new Date(Date.now() - 120000).toISOString(),
        is_test_mode: true
      }).select().single();

      const { data: sellB } = await supabase.from('mock_trades').insert({
        user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        strategy_id: strategyB,
        trade_type: 'sell',
        cryptocurrency: 'ETH-EUR',
        amount: 0.1,
        price: 2100,
        total_value: 210.00,
        fees: 10.50,
        executed_at: new Date().toISOString(),
        is_test_mode: true
      }).select().single();

      testResults.test_trades = { buyA, sellA, buyB, sellB };

      // 4. Run backfill again to process new trades
      const { data: backfill2 } = await supabase.functions.invoke('backfill-sell-snapshots', {
        body: {
          scope: 'single_user',
          userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
          mode: 'test',
          dryRun: false
        }
      });
      testResults.backfill_after_tests = backfill2;

      // 5. Final validation
      const { data: finalSells } = await supabase
        .from('mock_trades')
        .select('id, cryptocurrency, amount, price, original_purchase_amount, original_purchase_price, original_purchase_value, exit_value, buy_fees, sell_fees, realized_pnl, realized_pnl_pct')
        .eq('trade_type', 'sell')
        .in('id', [sellA?.id, sellB?.id]);
      testResults.final_sell_snapshots = finalSells;

      const { data: finalPast } = await supabase
        .from('past_positions_view')
        .select('*')
        .order('exit_at', { ascending: false })
        .limit(5);
      testResults.final_past_positions = finalPast;

      setResults(testResults);
      
    } catch (error) {
      console.error('Test error:', error);
      setResults({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Backfill Test Runner</h2>
      
      <Button 
        onClick={runFullTest} 
        disabled={loading}
        className="mb-4"
      >
        {loading ? 'Running Tests...' : 'Run Full Backfill Test'}
      </Button>

      {results && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Test Results:</h3>
          <pre className="bg-muted p-4 rounded-lg overflow-auto text-sm">
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </Card>
  );
};