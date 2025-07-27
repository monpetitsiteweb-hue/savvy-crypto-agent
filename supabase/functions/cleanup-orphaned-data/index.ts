import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create admin client with service role key
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the current user to verify admin privileges
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if current user is admin
    const { data: adminCheck } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single()

    if (!adminCheck) {
      return new Response(
        JSON.stringify({ error: 'Admin privileges required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Starting cleanup of orphaned data...')

    // Get all user_roles
    const { data: allRoles } = await supabaseAdmin
      .from('user_roles')
      .select('user_id')

    if (!allRoles) {
      return new Response(
        JSON.stringify({ message: 'No roles found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userIds = [...new Set(allRoles.map(role => role.user_id))]
    console.log(`Found ${userIds.length} unique user IDs in roles table`)

    let orphanedCount = 0

    // Check each user ID to see if it exists in auth.users
    for (const userId of userIds) {
      const { data: authUser, error } = await supabaseAdmin.auth.admin.getUserById(userId)
      
      if (error || !authUser.user) {
        console.log(`Found orphaned user data for ID: ${userId}`)
        
        // Delete orphaned data for this user
        await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
        await supabaseAdmin.from('profiles').delete().eq('id', userId)
        await supabaseAdmin.from('trading_strategies').delete().eq('user_id', userId)
        await supabaseAdmin.from('trading_history').delete().eq('user_id', userId)
        await supabaseAdmin.from('user_coinbase_connections').delete().eq('user_id', userId)
        await supabaseAdmin.from('mock_trades').delete().eq('user_id', userId)
        await supabaseAdmin.from('strategy_performance').delete().eq('user_id', userId)
        await supabaseAdmin.from('conversation_history').delete().eq('user_id', userId)
        await supabaseAdmin.from('ai_learning_metrics').delete().eq('user_id', userId)
        await supabaseAdmin.from('ai_knowledge_base').delete().eq('user_id', userId)
        await supabaseAdmin.from('ai_data_sources').delete().eq('user_id', userId)
        await supabaseAdmin.from('data_sources').delete().eq('user_id', userId)
        await supabaseAdmin.from('crypto_news').delete().eq('user_id', userId)
        await supabaseAdmin.from('whale_signal_events').delete().eq('user_id', userId)
        await supabaseAdmin.from('live_signals').delete().eq('user_id', userId)
        await supabaseAdmin.from('historical_market_data').delete().eq('user_id', userId)
        await supabaseAdmin.from('external_market_data').delete().eq('user_id', userId)
        await supabaseAdmin.from('price_data').delete().eq('user_id', userId)
        await supabaseAdmin.from('ai_category_performance').delete().eq('user_id', userId)
        
        orphanedCount++
      }
    }

    console.log(`Cleaned up ${orphanedCount} orphaned user records`)

    return new Response(
      JSON.stringify({ 
        message: `Cleanup completed. Removed ${orphanedCount} orphaned user records.`,
        orphanedCount 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Cleanup error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})