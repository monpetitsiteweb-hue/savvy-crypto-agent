// Temporary script to test backfill function
import { supabase } from "@/integrations/supabase/client";

const runBackfillTest = async () => {
  try {
    console.log('🔄 Running backfill function...');
    
    // Call the backfill function with your user ID
    const { data, error } = await supabase.functions.invoke('backfill-sell-snapshots', {
      body: {
        scope: 'single_user',
        userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        mode: 'test',
        dryRun: false
      }
    });
    
    if (error) {
      console.error('❌ Backfill error:', error);
      return;
    }
    
    console.log('✅ Backfill result:', JSON.stringify(data, null, 2));
    
    // Now create test trades
    console.log('🔄 Creating test BUY trades...');
    
    // Sequence A: COINBASE_PRO (0% fees)
    const buyA = await supabase.from('mock_trades').insert({
      user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
      strategy_id: crypto.randomUUID(),
      trade_type: 'buy',
      cryptocurrency: 'XRP-EUR',
      amount: 100,
      price: 0.50,
      total_value: 50.00,
      fees: 0.00,
      executed_at: new Date(Date.now() - 60000).toISOString(),
      is_test_mode: true
    }).select().single();
    
    if (buyA.error) {
      console.error('❌ Buy A error:', buyA.error);
      return;
    }
    
    console.log('✅ Buy A created:', buyA.data);
    
    // Sequence B: OTHER (5% fees)  
    const buyB = await supabase.from('mock_trades').insert({
      user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
      strategy_id: crypto.randomUUID(),
      trade_type: 'buy',
      cryptocurrency: 'ETH-EUR',
      amount: 0.1,
      price: 2000,
      total_value: 200.00,
      fees: 10.00,
      executed_at: new Date(Date.now() - 120000).toISOString(),
      is_test_mode: true
    }).select().single();
    
    if (buyB.error) {
      console.error('❌ Buy B error:', buyB.error);
      return;
    }
    
    console.log('✅ Buy B created:', buyB.data);
    
    // Now create corresponding SELL trades
    console.log('🔄 Creating test SELL trades...');
    
    const sellA = await supabase.from('mock_trades').insert({
      user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
      strategy_id: buyA.data.strategy_id,
      trade_type: 'sell',
      cryptocurrency: 'XRP-EUR',
      amount: 100,
      price: 0.55,
      total_value: 55.00,
      fees: 0.00,
      executed_at: new Date().toISOString(),
      is_test_mode: true
    }).select().single();
    
    const sellB = await supabase.from('mock_trades').insert({
      user_id: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
      strategy_id: buyB.data.strategy_id,
      trade_type: 'sell',
      cryptocurrency: 'ETH-EUR',
      amount: 0.1,
      price: 2100,
      total_value: 210.00,
      fees: 10.50,
      executed_at: new Date().toISOString(),
      is_test_mode: true
    }).select().single();
    
    console.log('✅ Sell A created:', sellA.data);
    console.log('✅ Sell B created:', sellB.data);
    
    // Run backfill again to update the new SELLs
    console.log('🔄 Running backfill again for new trades...');
    
    const { data: data2, error: error2 } = await supabase.functions.invoke('backfill-sell-snapshots', {
      body: {
        scope: 'single_user',
        userId: '25a0c221-1f0e-431d-8d79-db9fb4db9cb3',
        mode: 'test',
        dryRun: false
      }
    });
    
    if (error2) {
      console.error('❌ Second backfill error:', error2);
      return;
    }
    
    console.log('✅ Second backfill result:', JSON.stringify(data2, null, 2));
    
    // Check past positions view
    const { data: pastPositions, error: pastError } = await supabase
      .from('past_positions_view')
      .select('*')
      .order('exit_at', { ascending: false })
      .limit(5);
      
    if (pastError) {
      console.error('❌ Past positions error:', pastError);
      return;
    }
    
    console.log('✅ Past positions (first 5):', JSON.stringify(pastPositions, null, 2));
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
};

// Export for manual execution
export { runBackfillTest };