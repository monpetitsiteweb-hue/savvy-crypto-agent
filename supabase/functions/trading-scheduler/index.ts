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
    console.log('Trading scheduler triggered');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Call the automated trading engine
    const { data, error } = await supabase.functions.invoke('automated-trading-engine');
    
    if (error) {
      console.error('Error calling automated trading engine:', error);
      throw error;
    }

    console.log('Automated trading engine result:', data);
    
    return new Response(JSON.stringify({ 
      message: 'Trading scheduler completed successfully',
      timestamp: new Date().toISOString(),
      engineResult: data
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in trading scheduler:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});