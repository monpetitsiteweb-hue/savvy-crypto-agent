import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    console.log('Request body:', requestBody);
    
    const { connectionId } = requestBody;
    console.log('Connection ID:', connectionId, 'Type:', typeof connectionId);
    
    if (!connectionId) {
      console.log('No connection ID provided');
      return new Response(
        JSON.stringify({ error: 'Connection ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    console.log('Supabase URL:', supabaseUrl ? 'Present' : 'Missing');
    console.log('Service Key:', supabaseServiceKey ? 'Present' : 'Missing');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get the connection details
    const { data: connection, error: connectionError } = await supabase
      .from('user_coinbase_connections')
      .select('*')
      .eq('id', connectionId)
      .maybeSingle();

    if (connectionError) {
      console.error('Connection error:', connectionError);
      return new Response(
        JSON.stringify({ error: 'Database error while fetching connection', details: connectionError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!connection) {
      console.error('No connection found for ID:', connectionId);
      return new Response(
        JSON.stringify({ error: 'Connection not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // For now, return mock trading history data
    // In a real implementation, you would use the Coinbase API with the stored credentials
    const mockTradingHistory = [
      {
        id: '1',
        trade_type: 'buy',
        cryptocurrency: 'BTC',
        amount: 0.001,
        price: 45000,
        total_value: 45,
        executed_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        fees: 0.5,
        notes: 'Automated purchase via strategy'
      },
      {
        id: '2',
        trade_type: 'sell',
        cryptocurrency: 'ETH',
        amount: 0.1,
        price: 3000,
        total_value: 300,
        executed_at: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        fees: 1.5,
        notes: 'Profit taking at resistance level'
      },
      {
        id: '3',
        trade_type: 'buy',
        cryptocurrency: 'ETH',
        amount: 0.15,
        price: 2800,
        total_value: 420,
        executed_at: new Date(Date.now() - 259200000).toISOString(), // 3 days ago
        fees: 2.1,
        notes: 'DCA strategy execution'
      }
    ];

    // Insert mock data into trading_history table for this user
    console.log('About to insert trading history for user:', connection.user_id);
    
    // First, delete any existing mock data for this connection to avoid duplicates
    const { error: deleteError } = await supabase
      .from('trading_history')
      .delete()
      .eq('user_coinbase_connection_id', connectionId)
      .like('coinbase_order_id', 'mock_order_%');

    if (deleteError) {
      console.error('Delete error:', deleteError);
      // Don't fail on delete error, just log it
    }

    // Prepare the data for insertion
    const tradesData = mockTradingHistory.map(trade => ({
      trade_type: trade.trade_type,
      cryptocurrency: trade.cryptocurrency,
      amount: trade.amount,
      price: trade.price,
      total_value: trade.total_value,
      executed_at: trade.executed_at,
      fees: trade.fees,
      notes: trade.notes,
      user_id: connection.user_id,
      user_coinbase_connection_id: connectionId,
      coinbase_order_id: `mock_order_${trade.id}_${Date.now()}`
    }));

    console.log('About to insert trades data:', tradesData);

    // Then insert the new mock data
    const { error: insertError } = await supabase
      .from('trading_history')
      .insert(tradesData);

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Failed to save trading history', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Successfully inserted trading history');

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Trading history fetched successfully',
        trades: mockTradingHistory.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in coinbase-trading-history function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});