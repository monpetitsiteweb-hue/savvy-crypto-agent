// @ts-nocheck
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SourceConfiguration {
  refresh_mode: 'static' | 'feed';
  video_url?: string;
  channel_url?: string;
  youtube_api_key?: string;
  handle?: string;
  url?: string;
  subreddit?: string;
  update_frequency?: number;
  filters?: any;
  custom_name?: string;
  title?: string;
  tags?: string[];
}

async function scrapeWebsite(url: string): Promise<{ title: string; content: string }> {
  try {
    console.log(`🌐 Scraping website: ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
    
    // Extract text content (simple extraction)
    const textContent = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return {
      title,
      content: textContent.substring(0, 10000) // Limit to 10000 chars
    };
  } catch (error) {
    console.error(`❌ Failed to scrape ${url}:`, error);
    return {
      title: new URL(url).hostname,
      content: `Failed to fetch content from ${url}: ${error.message}`
    };
  }
}

async function fetchYouTubeVideo(videoUrl: string): Promise<{ title: string; content: string }> {
  try {
    console.log(`📺 Fetching YouTube video: ${videoUrl}`);
    
    // Extract video ID
    const videoIdMatch = videoUrl.match(/(?:v=|\/embed\/|\/watch\?v=|youtu\.be\/)([^&?\/\s]+)/);
    if (!videoIdMatch) {
      throw new Error('Invalid YouTube video URL');
    }
    
    const videoId = videoIdMatch[1];
    
    // For now, return placeholder content
    // TODO: Implement actual transcript fetching via YouTube API or third-party service
    return {
      title: `YouTube Video: ${videoId}`,
      content: `Placeholder content for YouTube video ${videoId}. Full transcript extraction will be implemented with YouTube API integration.`
    };
  } catch (error) {
    console.error(`❌ Failed to fetch YouTube video ${videoUrl}:`, error);
    return {
      title: 'YouTube Video (Error)',
      content: `Failed to fetch video content: ${error.message}`
    };
  }
}

async function fetchYouTubeChannelFeed(channelUrl: string, apiKey: string | undefined, lastSync: string | null): Promise<Array<{ title: string; content: string; metadata: any }>> {
  try {
    console.log(`📺 Fetching YouTube channel feed: ${channelUrl}`);
    
    // Extract channel ID or username
    const channelMatch = channelUrl.match(/(?:channel\/|@|user\/)([^\/\?]+)/);
    if (!channelMatch) {
      throw new Error('Invalid YouTube channel URL');
    }
    
    const channelId = channelMatch[1];
    
    // For now, return placeholder items
    // TODO: Implement actual feed fetching via YouTube API or RSS
    const placeholderItems = [
      {
        title: `Recent Video from ${channelId}`,
        content: `Placeholder content for recent video from YouTube channel ${channelId}. Feed ingestion will be implemented with YouTube API/RSS integration.`,
        metadata: { channel_url: channelUrl, video_id: 'placeholder', published_at: new Date().toISOString() }
      }
    ];
    
    return placeholderItems;
  } catch (error) {
    console.error(`❌ Failed to fetch YouTube channel feed ${channelUrl}:`, error);
    return [];
  }
}

async function fetchXAccountFeed(handle: string, lastSync: string | null): Promise<Array<{ title: string; content: string; metadata: any }>> {
  try {
    console.log(`🐦 Fetching X/Twitter account feed: @${handle}`);
    
    // For now, return placeholder items
    // TODO: Implement actual X/Twitter API integration
    const placeholderItems = [
      {
        title: `Recent post from @${handle}`,
        content: `Placeholder content for X account @${handle}. Twitter/X API integration will be implemented to fetch actual tweets.`,
        metadata: { handle, tweet_id: 'placeholder', published_at: new Date().toISOString() }
      }
    ];
    
    return placeholderItems;
  } catch (error) {
    console.error(`❌ Failed to fetch X account feed @${handle}:`, error);
    return [];
  }
}

async function fetchRedditFeed(subreddit: string, lastSync: string | null): Promise<Array<{ title: string; content: string; metadata: any }>> {
  try {
    console.log(`📱 Fetching Reddit feed: r/${subreddit}`);
    
    // Use Reddit's public JSON API
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=10`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeCollector/1.0)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Reddit API returned ${response.status}`);
    }
    
    const data = await response.json();
    const posts = data?.data?.children || [];
    
    // Filter by lastSync if provided
    const sinceTimestamp = lastSync ? new Date(lastSync).getTime() / 1000 : 0;
    const filteredPosts = posts.filter((post: any) => post.data.created_utc > sinceTimestamp);
    
    return filteredPosts.map((post: any) => ({
      title: post.data.title,
      content: post.data.selftext || post.data.url || 'Link post (no text content)',
      metadata: {
        subreddit,
        post_id: post.data.id,
        author: post.data.author,
        url: `https://reddit.com${post.data.permalink}`,
        published_at: new Date(post.data.created_utc * 1000).toISOString()
      }
    }));
  } catch (error) {
    console.error(`❌ Failed to fetch Reddit feed r/${subreddit}:`, error);
    return [];
  }
}

async function handleStaticSource(
  supabase: any,
  source: any,
  config: SourceConfiguration
): Promise<number> {
  console.log(`📄 Processing STATIC source: ${source.source_name}`);
  
  let title = '';
  let content = '';
  let metadata: any = {};
  
  // Determine source type and fetch content
  if (config.video_url) {
    // YouTube Video (static)
    const result = await fetchYouTubeVideo(config.video_url);
    title = config.title || result.title;
    content = result.content;
    metadata = { video_url: config.video_url, tags: config.tags || [] };
  } else if (config.url) {
    // Website Page (static)
    const result = await scrapeWebsite(config.url);
    title = config.custom_name || result.title;
    content = result.content;
    metadata = { url: config.url, tags: config.tags || [] };
  } else if (source.source_name === 'pdf_document') {
    // PDF Upload (static)
    // TODO: Implement PDF text extraction from Supabase Storage
    title = config.title || 'PDF Document';
    content = 'PDF text extraction placeholder. Will be implemented with PDF parsing library.';
    metadata = { storage_path: config.url || '', tags: config.tags || [] };
  } else {
    throw new Error(`Unknown static source configuration for ${source.source_name}`);
  }
  
  // Insert document into knowledge_documents
  const { error: insertError } = await supabase
    .from('knowledge_documents')
    .insert({
      source_id: source.id,
      user_id: source.user_id,
      title,
      content,
      metadata
    });
  
  if (insertError) {
    console.error('❌ Error inserting knowledge document:', insertError);
    throw insertError;
  }
  
  console.log(`✅ Created 1 knowledge document for static source ${source.source_name}`);
  return 1;
}

async function handleFeedSource(
  supabase: any,
  source: any,
  config: SourceConfiguration
): Promise<number> {
  console.log(`🔄 Processing FEED source: ${source.source_name}`);
  
  let items: Array<{ title: string; content: string; metadata: any }> = [];
  
  // Fetch new items based on source type
  if (config.channel_url) {
    // YouTube Channel (feed)
    items = await fetchYouTubeChannelFeed(config.channel_url, config.youtube_api_key, source.last_sync);
  } else if (config.handle) {
    // X/Twitter Account (feed)
    items = await fetchXAccountFeed(config.handle, source.last_sync);
  } else if (config.subreddit) {
    // Reddit Community (feed)
    items = await fetchRedditFeed(config.subreddit, source.last_sync);
  } else {
    throw new Error(`Unknown feed source configuration for ${source.source_name}`);
  }
  
  console.log(`📦 Found ${items.length} new items for feed source ${source.source_name}`);
  
  // Insert each item as a separate knowledge document
  let documentsCreated = 0;
  for (const item of items) {
    const { error: insertError } = await supabase
      .from('knowledge_documents')
      .insert({
        source_id: source.id,
        user_id: source.user_id,
        title: item.title,
        content: item.content,
        metadata: item.metadata
      });
    
    if (insertError) {
      console.error('❌ Error inserting knowledge document:', insertError);
      // Continue with other items even if one fails
      continue;
    }
    
    documentsCreated++;
  }
  
  console.log(`✅ Created ${documentsCreated} knowledge documents for feed source ${source.source_name}`);
  return documentsCreated;
}

serve(async (req) => {
  console.log('=== Knowledge Collector Function Called ===');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const { sourceId } = await req.json();
    
    if (!sourceId) {
      return new Response(JSON.stringify({ 
        error: 'sourceId is required',
        success: false
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Initialize Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Load the source from ai_data_sources
    const { data: source, error: sourceError } = await supabase
      .from('ai_data_sources')
      .select('*')
      .eq('id', sourceId)
      .single();
    
    if (sourceError || !source) {
      console.error('❌ Source not found:', sourceError);
      return new Response(JSON.stringify({ 
        error: 'Source not found',
        success: false
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log(`📚 Processing source: ${source.source_name} (${source.source_type})`);
    
    // Extract configuration
    const config: SourceConfiguration = source.configuration || {};
    const refreshMode = config.refresh_mode || 'static';
    
    let documentsCreated = 0;
    
    // Process based on refresh_mode
    if (refreshMode === 'static') {
      documentsCreated = await handleStaticSource(supabase, source, config);
    } else if (refreshMode === 'feed') {
      documentsCreated = await handleFeedSource(supabase, source, config);
    } else {
      throw new Error(`Unknown refresh_mode: ${refreshMode}`);
    }
    
    // Update last_sync timestamp in ai_data_sources
    const { error: updateError } = await supabase
      .from('ai_data_sources')
      .update({ last_sync: new Date().toISOString() })
      .eq('id', sourceId);
    
    if (updateError) {
      console.error('❌ Error updating last_sync:', updateError);
      // Don't throw - documents were created successfully
    }
    
    console.log(`✅ Knowledge collection completed for source ${sourceId}`);
    
    return new Response(JSON.stringify({ 
      success: true,
      sourceId,
      documents_created: documentsCreated
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('❌ Knowledge collection error:', error);
    return new Response(JSON.stringify({ 
      error: 'Knowledge collection failed',
      success: false,
      details: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
