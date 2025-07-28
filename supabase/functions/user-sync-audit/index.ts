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
    // Create admin client for system operations
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

    console.log('Starting user sync audit...');

    // Get all auth.users
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      throw new Error(`Failed to fetch auth users: ${authError.message}`);
    }

    console.log(`Found ${authUsers.users.length} auth users`);

    let repaired = 0;
    let errors = 0;
    const repairLog = [];

    for (const authUser of authUsers.users) {
      try {
        // Check if profile exists
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('id', authUser.id)
          .maybeSingle();

        if (profileError) {
          console.error(`Error checking profile for ${authUser.id}:`, profileError);
          errors++;
          continue;
        }

        // Check if role exists
        const { data: role, error: roleError } = await supabaseAdmin
          .from('user_roles')
          .select('user_id')
          .eq('user_id', authUser.id)
          .maybeSingle();

        if (roleError) {
          console.error(`Error checking role for ${authUser.id}:`, roleError);
          errors++;
          continue;
        }

        let needsRepair = false;
        
        // Create missing profile
        if (!profile) {
          const { error: insertProfileError } = await supabaseAdmin
            .from('profiles')
            .insert({
              id: authUser.id,
              full_name: authUser.user_metadata?.full_name || null,
              avatar_url: authUser.user_metadata?.avatar_url || null
            });

          if (insertProfileError) {
            console.error(`Failed to create profile for ${authUser.id}:`, insertProfileError);
            errors++;
          } else {
            console.log(`Created profile for ${authUser.email}`);
            needsRepair = true;
          }
        }

        // Create missing role
        if (!role) {
          const { error: insertRoleError } = await supabaseAdmin
            .from('user_roles')
            .insert({
              user_id: authUser.id,
              role: 'user'
            });

          if (insertRoleError) {
            console.error(`Failed to create role for ${authUser.id}:`, insertRoleError);
            errors++;
          } else {
            console.log(`Created role for ${authUser.email}`);
            needsRepair = true;
          }
        }

        if (needsRepair) {
          repaired++;
          repairLog.push({
            email: authUser.email,
            user_id: authUser.id,
            created_profile: !profile,
            created_role: !role
          });
        }

      } catch (error) {
        console.error(`Error processing user ${authUser.id}:`, error);
        errors++;
      }
    }

    const result = {
      success: true,
      total_auth_users: authUsers.users.length,
      users_repaired: repaired,
      errors_encountered: errors,
      repair_log: repairLog,
      message: `Audit complete: ${repaired} users repaired, ${errors} errors`
    };

    console.log('Audit complete:', result);

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
    console.error('User sync audit failed:', error);

    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message,
        message: 'User sync audit failed'
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