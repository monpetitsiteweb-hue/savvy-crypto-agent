// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🕐 Trading scheduler triggered');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get all users with active strategies
    const { data: activeUsers, error: usersError } = await supabase
      .from('trading_strategies')
      .select('user_id, is_active_test, is_active_live')
      .or('is_active_test.eq.true,is_active_live.eq.true');

    if (usersError) {
      console.error('❌ Error fetching active users:', usersError);
      throw usersError;
    }

    const uniqueUsers = [...new Set(activeUsers?.map(u => u.user_id) || [])];
    console.log(`📊 Found ${uniqueUsers.length} users with active strategies`);

    const results = [];

    for (const userId of uniqueUsers) {
      try {
        // Process test mode strategies
        console.log(`🧪 Processing test mode strategies for user: ${userId}`);
        const testResult = await supabase.functions.invoke('automated-trading-engine', {
          body: {
            action: 'process_signals',
            userId: userId,
            mode: 'mock'
          }
        });

        if (testResult.error) {
          console.error(`❌ Test mode error for user ${userId}:`, testResult.error);
        } else {
          console.log(`✅ Test mode completed for user ${userId}:`, testResult.data);
          results.push({
            userId,
            mode: 'test',
            success: true,
            result: testResult.data
          });
        }

        // Check if user has live strategies and valid Coinbase connection
        const { data: liveStrategies, error: liveError } = await supabase
          .from('trading_strategies')
          .select('id, strategy_name')
          .eq('user_id', userId)
          .eq('is_active_live', true);

        if (liveStrategies && liveStrategies.length > 0) {
          // Check for valid Coinbase connection
          const { data: connection, error: connError } = await supabase
            .from('user_coinbase_connections')
            .select('id, is_active, expires_at, access_token_encrypted, api_identifier_encrypted')
            .eq('user_id', userId)
            .eq('is_active', true)
            .single();

          if (connError || !connection) {
            console.log(`⚠️ User ${userId} has live strategies but no valid Coinbase connection - skipping live trades`);
            results.push({
              userId,
              mode: 'live',
              success: false,
              reason: 'No valid Coinbase connection',
              strategies_skipped: liveStrategies.length
            });
          } else if (connection.expires_at && new Date(connection.expires_at) < new Date()) {
            console.log(`⚠️ User ${userId} Coinbase connection expired - skipping live trades`);
            results.push({
              userId,
              mode: 'live', 
              success: false,
              reason: 'Coinbase connection expired',
              strategies_skipped: liveStrategies.length
            });
          } else {
            // Valid connection - process live strategies
            console.log(`💰 Processing live strategies for user: ${userId}`);
            const liveResult = await supabase.functions.invoke('automated-trading-engine', {
              body: {
                action: 'process_signals',
                userId: userId,
                mode: 'live'
              }
            });

            if (liveResult.error) {
              console.error(`❌ Live mode error for user ${userId}:`, liveResult.error);
              results.push({
                userId,
                mode: 'live',
                success: false,
                error: liveResult.error
              });
            } else {
              console.log(`✅ Live mode completed for user ${userId}:`, liveResult.data);
              results.push({
                userId,
                mode: 'live',
                success: true,
                result: liveResult.data
              });
            }
          }
        }

      } catch (userError) {
        console.error(`❌ Error processing user ${userId}:`, userError);
        results.push({
          userId,
          success: false,
          error: userError.message
        });
      }
    }

    const summary = {
      total_users: uniqueUsers.length,
      successful_executions: results.filter(r => r.success).length,
      failed_executions: results.filter(r => !r.success).length,
      test_mode_runs: results.filter(r => r.mode === 'test').length,
      live_mode_runs: results.filter(r => r.mode === 'live' && r.success).length,
      skipped_due_to_connection: results.filter(r => r.reason?.includes('connection')).length
    };

    console.log('📈 Trading scheduler summary:', summary);
    
    return new Response(JSON.stringify({ 
      message: 'Trading scheduler completed successfully',
      timestamp: new Date().toISOString(),
      summary,
      results: results.slice(0, 10) // Include first 10 results for debugging
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Trading scheduler error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});