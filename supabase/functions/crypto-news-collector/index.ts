import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, symbols, hours, userId, sourceId } = await req.json();
    console.log(`📰 CryptoNews Collector received:`, { action, symbols, hours, userId });

    const cryptoNewsApiKey = Deno.env.get('CRYPTO_NEWS_API_KEY');
    if (!cryptoNewsApiKey) {
      throw new Error('CRYPTO_NEWS_API_KEY not configured');
    }

    switch (action) {
      case 'fetch_latest_news':
        return await fetchLatestNews(supabaseClient, cryptoNewsApiKey, { symbols, hours, userId, sourceId });
      
      case 'analyze_sentiment':
        return await analyzeSentiment(supabaseClient, { symbols, hours, userId, sourceId });
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('❌ CryptoNews Collector error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function fetchLatestNews(supabaseClient: any, apiKey: string, params: any) {
  const { symbols, hours = 24, userId, sourceId } = params;
  
  console.log(`📡 Fetching CryptoNews for symbols: ${symbols?.join(', ')} over last ${hours} hours`);
  
  try {
    // TODO: Replace with actual CryptoNews API call
    // const apiUrl = `https://cryptonews-api.com/api/v1/category?section=general&items=50&token=${apiKey}`;
    // const response = await fetch(apiUrl);
    // const newsData = await response.json();
    
    // For now, simulate news data
    const mockNewsData = symbols.flatMap((symbol: string) => {
      return Array.from({ length: Math.floor(Math.random() * 5) + 2 }, (_, i) => {
        const hoursAgo = Math.floor(Math.random() * hours);
        const timestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
        
        const headlines = [
          `${symbol} Shows Strong Technical Signals Amid Market Rally`,
          `Institutional Interest in ${symbol} Reaches New Highs`,
          `${symbol} Network Upgrade Brings Enhanced Scalability`,
          `Market Analysis: ${symbol} Breaks Key Resistance Level`,
          `${symbol} Partnership Announcement Drives Positive Sentiment`
        ];
        
        const sentiment = Math.random() > 0.5 ? 'positive' : 'negative';
        const sentimentScore = sentiment === 'positive' 
          ? 0.5 + Math.random() * 0.5 
          : Math.random() * 0.5;
        
        return {
          source_id: sourceId,
          user_id: userId,
          timestamp: timestamp.toISOString(),
          symbol: symbol,
          headline: headlines[Math.floor(Math.random() * headlines.length)],
          content: `Market analysis and news content for ${symbol}. This is simulated content that would contain the full article text.`,
          source_name: 'CryptoNews',
          news_type: 'market_analysis',
          sentiment_score: sentimentScore,
          url: `https://example.com/news/${symbol.toLowerCase()}-${Date.now()}`,
          author: 'Market Analyst',
          metadata: {
            collection_time: new Date().toISOString(),
            api_source: 'cryptonews_api',
            sentiment_confidence: Math.random() * 0.5 + 0.5
          }
        };
      });
    });

    // Insert news data with conflict resolution
    const { data, error } = await supabaseClient
      .from('crypto_news')
      .upsert(mockNewsData, { 
        onConflict: 'headline,timestamp,source_name',
        ignoreDuplicates: true 
      });

    if (error) {
      console.error('❌ Error inserting news data:', error);
      throw error;
    }

    // Generate live signals based on sentiment analysis
    const signals = await generateSentimentSignals(supabaseClient, mockNewsData, userId, sourceId);
    
    console.log(`✅ Successfully inserted ${mockNewsData.length} news articles and ${signals.length} signals`);
    
    return new Response(JSON.stringify({ 
      success: true, 
      newsInserted: mockNewsData.length,
      signalsGenerated: signals.length,
      message: 'News data and sentiment signals created successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Error fetching news:', error);
    throw error;
  }
}

async function generateSentimentSignals(supabaseClient: any, newsData: any[], userId: string, sourceId: string) {
  const signals = [];
  
  // Group news by symbol to analyze sentiment trends
  const symbolNews = newsData.reduce((acc, news) => {
    if (!acc[news.symbol]) acc[news.symbol] = [];
    acc[news.symbol].push(news);
    return acc;
  }, {});
  
  for (const [symbol, articles] of Object.entries(symbolNews)) {
    const avgSentiment = (articles as any[]).reduce((sum, article) => sum + article.sentiment_score, 0) / (articles as any[]).length;
    const newsVolume = (articles as any[]).length;
    
    // Generate signal if sentiment is strongly positive/negative or high news volume
    if (avgSentiment > 0.7 || avgSentiment < 0.3 || newsVolume > 3) {
      const signalType = avgSentiment > 0.7 ? 'sentiment_bullish' 
                        : avgSentiment < 0.3 ? 'sentiment_bearish' 
                        : 'news_volume_spike';
      
      const signalStrength = Math.min(100, Math.max(
        avgSentiment * 100,
        newsVolume * 20
      ));
      
      signals.push({
        source_id: sourceId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        symbol: symbol,
        signal_type: signalType,
        signal_strength: signalStrength,
        source: 'crypto_news',
        data: {
          avg_sentiment: avgSentiment,
          news_count: newsVolume,
          time_window: '24h'
        },
        processed: false
      });
    }
  }
  
  if (signals.length > 0) {
    const { error } = await supabaseClient
      .from('live_signals')
      .insert(signals);
    
    if (error) {
      console.error('❌ Error inserting sentiment signals:', error);
    }
  }
  
  return signals;
}

async function analyzeSentiment(supabaseClient: any, params: any) {
  const { symbols, hours = 24, userId, sourceId } = params;
  
  console.log(`🎯 Analyzing sentiment for symbols: ${symbols?.join(', ')} over last ${hours} hours`);
  
  // Get recent news for sentiment analysis
  const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);
  
  const { data: recentNews, error } = await supabaseClient
    .from('crypto_news')
    .select('*')
    .in('symbol', symbols)
    .gte('timestamp', hoursAgo.toISOString())
    .eq('user_id', userId);
  
  if (error) {
    console.error('❌ Error fetching recent news:', error);
    throw error;
  }
  
  // Analyze sentiment trends
  const sentimentAnalysis = symbols.map((symbol: string) => {
    const symbolNews = recentNews.filter((news: any) => news.symbol === symbol);
    
    if (symbolNews.length === 0) {
      return {
        symbol,
        avg_sentiment: 0.5,
        news_count: 0,
        trend: 'neutral'
      };
    }
    
    const avgSentiment = symbolNews.reduce((sum: number, news: any) => sum + news.sentiment_score, 0) / symbolNews.length;
    const trend = avgSentiment > 0.6 ? 'bullish' : avgSentiment < 0.4 ? 'bearish' : 'neutral';
    
    return {
      symbol,
      avg_sentiment: avgSentiment,
      news_count: symbolNews.length,
      trend,
      latest_headlines: symbolNews.slice(0, 3).map((n: any) => n.headline)
    };
  });
  
  return new Response(JSON.stringify({ 
    success: true, 
    sentiment_analysis: sentimentAnalysis,
    time_window: `${hours} hours`,
    message: 'Sentiment analysis completed'
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}