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

    const { offset = 0, limit = 30, searchTerm = '' } = await req.json();

    // Get all auth.users with pagination
    const { data: authData, error: authError2 } = await supabaseAdmin.auth.admin.listUsers({
      page: Math.floor(offset / limit) + 1,
      perPage: limit
    });

    if (authError2) {
      throw new Error(`Failed to fetch auth users: ${authError2.message}`);
    }

    let filteredUsers = authData.users;

    // Apply search filter if provided
    if (searchTerm) {
      filteredUsers = authData.users.filter(user => 
        user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.user_metadata?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.id.includes(searchTerm)
      );
    }

    const customers = [];

    for (const authUser of filteredUsers) {
      try {
        // Get profile data
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('full_name, avatar_url, created_at, updated_at')
          .eq('id', authUser.id)
          .maybeSingle();

        // Get role data
        const { data: userRole } = await supabaseAdmin
          .from('user_roles')
          .select('role')
          .eq('user_id', authUser.id)
          .maybeSingle();

        // Get strategies count
        const { data: strategies } = await supabaseAdmin
          .from('trading_strategies')
          .select('id')
          .eq('user_id', authUser.id);

        // Get Coinbase connection status (check for active and non-expired connections)
        const { data: connections } = await supabaseAdmin
          .from('user_coinbase_connections')
          .select('is_active, expires_at, access_token_encrypted, api_private_key_encrypted')
          .eq('user_id', authUser.id)
          .eq('is_active', true);

        // Check if any connection is valid (either API key or non-expired OAuth)
        const hasValidConnection = connections && connections.some(conn => {
          // API key connections (no expiry) are always valid if active
          if (conn.api_private_key_encrypted) {
            return true;
          }
          // OAuth connections must not be expired
          if (conn.access_token_encrypted && conn.expires_at) {
            return new Date(conn.expires_at) > new Date();
          }
          return false;
        });

        customers.push({
          id: authUser.id,
          email: authUser.email || 'No email',
          created_at: authUser.created_at,
          full_name: profile?.full_name || authUser.user_metadata?.full_name || null,
          avatar_url: profile?.avatar_url || authUser.user_metadata?.avatar_url || null,
          role: userRole?.role || 'no-role',
          has_coinbase_connection: !!hasValidConnection,
          total_strategies: strategies?.length || 0,
          last_active: profile?.updated_at || authUser.created_at,
          // Add sync status indicators
          has_profile: !!profile,
          has_role: !!userRole,
          confirmed: !!authUser.email_confirmed_at
        });
      } catch (error) {
        console.error(`Error processing user ${authUser.id}:`, error);
        
        // Still include the user but mark as error
        customers.push({
          id: authUser.id,
          email: authUser.email || 'No email',
          created_at: authUser.created_at,
          full_name: authUser.user_metadata?.full_name || 'Error loading',
          avatar_url: null,
          role: 'error',
          has_coinbase_connection: false,
          total_strategies: 0,
          last_active: authUser.created_at,
          has_profile: false,
          has_role: false,
          confirmed: !!authUser.email_confirmed_at,
          error: true
        });
      }
    }

    return new Response(
      JSON.stringify({
        customers,
        total_count: authData.total || filteredUsers.length,
        success: true
      }),
      { 
        headers: { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        } 
      }
    );

  } catch (error) {
    console.error('Get customers failed:', error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        customers: [],
        total_count: 0
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