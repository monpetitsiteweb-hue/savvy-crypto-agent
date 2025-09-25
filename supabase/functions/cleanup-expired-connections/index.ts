// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create authenticated client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Verify admin access
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Invalid authentication');
    }

    // Check if user is admin
    const { data: userRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!userRole) {
      throw new Error('Admin access required');
    }

    console.log('Starting connection cleanup...');

    // 1. Deactivate expired OAuth connections
    const { data: expiredConnections, error: expiredError } = await supabaseAdmin
      .from('user_coinbase_connections')
      .update({ is_active: false })
      .lt('expires_at', new Date().toISOString())
      .is('access_token_encrypted', 'not.null')
      .eq('is_active', true)
      .select('id, user_id, expires_at');

    if (expiredError) {
      console.error('Error deactivating expired connections:', expiredError);
    } else {
      console.log(`Deactivated ${expiredConnections?.length || 0} expired OAuth connections`);
    }

    // 2. Find users with multiple active connections
    const { data: duplicateUsers, error: duplicateError } = await supabaseAdmin
      .rpc('find_users_with_multiple_connections', {});

    if (duplicateError) {
      console.log('Could not check for duplicate connections (RPC function may not exist)');
    }

    // 3. For each user, keep only the most recent active connection
    const { data: allActiveConnections, error: activeError } = await supabaseAdmin
      .from('user_coinbase_connections')
      .select('id, user_id, connected_at, is_active')
      .eq('is_active', true)
      .order('connected_at', { ascending: false });

    if (activeError) {
      throw new Error(`Failed to fetch active connections: ${activeError.message}`);
    }

    console.log(`Found ${allActiveConnections?.length || 0} active connections`);

    // Group by user_id and deactivate older connections
    const userConnections = new Map();
    let deactivatedCount = 0;

    for (const conn of allActiveConnections || []) {
      if (!userConnections.has(conn.user_id)) {
        // Keep the first (most recent) connection for each user
        userConnections.set(conn.user_id, conn.id);
      } else {
        // Deactivate older connections
        const { error: deactivateError } = await supabaseAdmin
          .from('user_coinbase_connections')
          .update({ is_active: false })
          .eq('id', conn.id);

        if (deactivateError) {
          console.error(`Failed to deactivate connection ${conn.id}:`, deactivateError);
        } else {
          console.log(`Deactivated older connection ${conn.id} for user ${conn.user_id}`);
          deactivatedCount++;
        }
      }
    }

    const result = {
      success: true,
      expired_deactivated: expiredConnections?.length || 0,
      duplicate_deactivated: deactivatedCount,
      total_cleaned: (expiredConnections?.length || 0) + deactivatedCount
    };

    console.log('Cleanup completed:', result);

    return new Response(
      JSON.stringify(result),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Connection cleanup failed:', error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message
      }),
      { 
        status: 500,
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );
  }
});
