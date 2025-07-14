import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ 
    success: true,
    message: 'BASIC FUNCTION WORKS - Edge function is running',
    timestamp: new Date().toISOString(),
    method: req.method
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});