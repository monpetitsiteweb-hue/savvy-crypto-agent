import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DataSource {
  id: string;
  name: string;
  type: 'youtube' | 'website' | 'twitter' | 'document';
  url?: string;
  content?: string;
  last_updated?: string;
  metadata?: any;
}

async function scrapeWebsite(url: string): Promise<string> {
  try {
    console.log(`🌐 Scraping website: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    
    // Extract text content (simple extraction)
    const textContent = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return textContent.substring(0, 5000); // Limit to 5000 chars
  } catch (error) {
    console.error(`❌ Failed to scrape ${url}:`, error);
    return `Failed to fetch content from ${url}`;
  }
}

async function getYouTubeChannelInfo(channelUrl: string): Promise<string> {
  try {
    console.log(`📺 Processing YouTube channel: ${channelUrl}`);
    
    // Extract channel ID or username from URL
    const channelMatch = channelUrl.match(/(?:channel\/|@|user\/)([^\/\?]+)/);
    if (!channelMatch) {
      return `Invalid YouTube channel URL: ${channelUrl}`;
    }
    
    const channelId = channelMatch[1];
    
    // For now, return basic info - would need YouTube API for real data
    return `YouTube Channel: ${channelId}. Content focus: Cryptocurrency trading, market analysis, educational content.`;
  } catch (error) {
    console.error(`❌ Failed to process YouTube channel ${channelUrl}:`, error);
    return `Failed to process YouTube channel: ${channelUrl}`;
  }
}

async function getTwitterContent(twitterUrl: string): Promise<string> {
  try {
    console.log(`🐦 Processing Twitter: ${twitterUrl}`);
    
    // Extract username from URL
    const usernameMatch = twitterUrl.match(/twitter\.com\/([^\/\?]+)/i);
    if (!usernameMatch) {
      return `Invalid Twitter URL: ${twitterUrl}`;
    }
    
    const username = usernameMatch[1];
    
    // For now, return basic info - would need Twitter API for real data
    return `Twitter Account: @${username}. Focus: Market insights, trading signals, crypto news.`;
  } catch (error) {
    console.error(`❌ Failed to process Twitter ${twitterUrl}:`, error);
    return `Failed to process Twitter account: ${twitterUrl}`;
  }
}

async function collectKnowledge(userId: string): Promise<string> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log(`🧠 Collecting knowledge for user: ${userId}`);
  
  // Get all data sources for the user
  const { data: dataSources, error: dsError } = await supabase
    .from('data_sources')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true);
  
  if (dsError) {
    console.error('❌ Error fetching data sources:', dsError);
    return 'No additional knowledge sources available.';
  }
  
  if (!dataSources || dataSources.length === 0) {
    return 'No data sources configured for enhanced decision making.';
  }
  
  console.log(`📚 Found ${dataSources.length} data sources to process`);
  
  let knowledgeBase = '=== ENHANCED MARKET INTELLIGENCE ===\n\n';
  
  for (const source of dataSources) {
    try {
      console.log(`🔄 Processing source: ${source.name} (${source.type})`);
      
      let content = '';
      
      switch (source.type) {
        case 'website':
          if (source.url) {
            content = await scrapeWebsite(source.url);
          }
          break;
          
        case 'youtube':
          if (source.url) {
            content = await getYouTubeChannelInfo(source.url);
          }
          break;
          
        case 'twitter':
          if (source.url) {
            content = await getTwitterContent(source.url);
          }
          break;
          
        case 'document':
          content = source.content || 'Document content not available';
          break;
          
        default:
          content = `Unknown source type: ${source.type}`;
      }
      
      knowledgeBase += `## ${source.name} (${source.type.toUpperCase()})\n`;
      knowledgeBase += `${content}\n\n`;
      
      // Update last_updated timestamp
      await supabase
        .from('data_sources')
        .update({ 
          last_updated: new Date().toISOString(),
          metadata: { last_content_length: content.length }
        })
        .eq('id', source.id);
        
    } catch (error) {
      console.error(`❌ Error processing source ${source.name}:`, error);
      knowledgeBase += `## ${source.name} (${source.type.toUpperCase()})\n`;
      knowledgeBase += `Error processing this source: ${error.message}\n\n`;
    }
  }
  
  knowledgeBase += '=== END INTELLIGENCE SOURCES ===\n';
  
  console.log(`✅ Knowledge collection completed. Total length: ${knowledgeBase.length} characters`);
  
  return knowledgeBase;
}

serve(async (req) => {
  console.log('=== Knowledge Collector Function Called ===');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { userId } = await req.json();
    
    if (!userId) {
      return new Response(JSON.stringify({ 
        error: 'User ID required',
        knowledge: 'No user specified for knowledge collection.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const knowledge = await collectKnowledge(userId);
    
    return new Response(JSON.stringify({ 
      success: true,
      knowledge: knowledge,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Knowledge collection error:', error);
    return new Response(JSON.stringify({ 
      error: 'Knowledge collection failed',
      knowledge: 'Error collecting enhanced market intelligence.',
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});