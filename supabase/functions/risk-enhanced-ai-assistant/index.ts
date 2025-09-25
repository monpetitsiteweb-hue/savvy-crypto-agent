// @ts-nocheck
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

    const { action, userId, tradeRequest, signalData } = await req.json();
    console.log(`🧠 Risk-Enhanced AI Assistant: ${action}`);

    switch (action) {
      case 'assess_trade_risk':
        return await assessTradeRisk(supabaseClient, { userId, tradeRequest });
      
      case 'analyze_signal_with_risk':
        return await analyzeSignalWithRisk(supabaseClient, { userId, signalData });
      
      case 'get_risk_explanation':
        return await getRiskExplanation(supabaseClient, { userId, tradeRequest });
      
      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
  } catch (error) {
    console.error('❌ Risk-Enhanced AI Assistant error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

async function assessTradeRisk(supabaseClient: any, params: any) {
  const { userId, tradeRequest } = params;
  
  console.log(`🛡️ Assessing trade risk for user ${userId}`);
  
  try {
    // Get user risk preferences
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single();

    let userPrefs = null;
    if (profile?.username) {
      try {
        const parsed = JSON.parse(profile.username);
        userPrefs = parsed.riskPreferences;
      } catch (e) {
        console.log('No risk preferences found');
      }
    }

    const riskLimits = userPrefs?.riskLimits || {
      maxDailyLoss: 500,
      maxTradesPerDay: 10,
      maxPositionSize: 5,
      stopLossPercentage: 3,
      takeProfitPercentage: 6
    };

    // Get daily trading stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const { data: todayTrades } = await supabaseClient
      .from('mock_trades')
      .select('profit_loss, total_value')
      .eq('user_id', userId)
      .gte('executed_at', today.toISOString());

    const dailyStats = {
      trades: todayTrades?.length || 0,
      pnl: todayTrades?.reduce((sum, trade) => sum + (trade.profit_loss || 0), 0) || 0
    };

    // Calculate risk assessment
    const portfolioValue = 10000; // Mock portfolio value
    const tradeValue = tradeRequest.amount * tradeRequest.price;
    const positionSizePercent = (tradeValue / portfolioValue) * 100;

    // Risk factors
    const riskFactors = [];
    let riskScore = 0;

    if (dailyStats.trades >= riskLimits.maxTradesPerDay * 0.8) {
      riskFactors.push('High daily trade frequency');
      riskScore += 2;
    }

    if (Math.abs(dailyStats.pnl) >= riskLimits.maxDailyLoss * 0.7) {
      riskFactors.push('Significant daily losses');
      riskScore += 3;
    }

    if (positionSizePercent > riskLimits.maxPositionSize) {
      riskFactors.push('Large position size');
      riskScore += 2;
    }

    if (tradeValue > (userPrefs?.maxTradeSize || 500)) {
      riskFactors.push('Exceeds max trade size');
      riskScore += 1;
    }

    // Determine risk level
    let riskLevel = 'low';
    if (riskScore >= 3) riskLevel = 'medium';
    if (riskScore >= 5) riskLevel = 'high';

    // Calculate stop loss and take profit
    const stopLoss = tradeRequest.action === 'buy' 
      ? tradeRequest.price * (1 - riskLimits.stopLossPercentage / 100)
      : tradeRequest.price * (1 + riskLimits.stopLossPercentage / 100);

    const takeProfit = riskLimits.takeProfitPercentage
      ? tradeRequest.action === 'buy'
        ? tradeRequest.price * (1 + riskLimits.takeProfitPercentage / 100)
        : tradeRequest.price * (1 - riskLimits.takeProfitPercentage / 100)
      : null;

    const maxLoss = tradeValue * (riskLimits.stopLossPercentage / 100);

    // Can execute?
    const canExecute = 
      dailyStats.trades < riskLimits.maxTradesPerDay &&
      Math.abs(dailyStats.pnl) < riskLimits.maxDailyLoss &&
      tradeValue <= (userPrefs?.maxTradeSize || 500);

    // Generate AI explanation
    const explanation = generateRiskExplanation({
      riskLevel,
      riskFactors,
      canExecute,
      stopLoss,
      takeProfit,
      maxLoss,
      dailyStats,
      riskLimits,
      tradeRequest
    });

    const assessment = {
      riskLevel,
      riskScore,
      riskFactors,
      canExecute,
      stopLoss,
      takeProfit,
      maxLoss,
      positionSizePercent,
      dailyStats,
      explanation,
      recommendation: canExecute ? 
        `${riskLevel.toUpperCase()}-RISK: Proceed with stop loss at €${stopLoss.toFixed(2)}` :
        'BLOCKED: Risk limits exceeded - trade cannot be executed'
    };

    return new Response(JSON.stringify({ 
      success: true, 
      assessment,
      message: `Risk assessment completed for ${tradeRequest.cryptocurrency} trade`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Risk assessment error:', error);
    throw error;
  }
}

async function analyzeSignalWithRisk(supabaseClient: any, params: any) {
  const { userId, signalData } = params;
  
  console.log(`📊 Analyzing signal with risk context for user ${userId}`);
  
  try {
    // Get signal strength and type
    const signalStrength = signalData.signal_strength || 0;
    const signalType = signalData.signal_type || 'unknown';
    const symbol = signalData.symbol || 'BTC';

    // Get user preferences for confidence threshold
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', userId)
      .single();

    let confidenceThreshold = 0.7;
    if (profile?.username) {
      try {
        const parsed = JSON.parse(profile.username);
        confidenceThreshold = parsed.riskPreferences?.confidenceThreshold || 0.7;
      } catch (e) {
        console.log('Using default confidence threshold');
      }
    }

    // Get recent AI knowledge about this signal type
    const { data: knowledge } = await supabaseClient
      .from('ai_knowledge_base')
      .select('*')
      .eq('user_id', userId)
      .eq('knowledge_type', 'signal_correlation')
      .ilike('content', `%${signalType}%`)
      .order('updated_at', { ascending: false })
      .limit(3);

    // Calculate signal confidence based on historical performance
    let historicalAccuracy = 0.5;
    if (knowledge && knowledge.length > 0) {
      const avgConfidence = knowledge.reduce((sum, k) => sum + k.confidence_score, 0) / knowledge.length;
      historicalAccuracy = avgConfidence;
    }

    // Combined confidence score
    const normalizedStrength = signalStrength / 100;
    const combinedConfidence = (normalizedStrength * 0.6) + (historicalAccuracy * 0.4);

    // Risk-adjusted recommendation
    let recommendation = '';
    let shouldAct = false;

    if (combinedConfidence >= confidenceThreshold) {
      shouldAct = true;
      if (combinedConfidence >= 0.8) {
        recommendation = `HIGH-CONFIDENCE signal detected for ${symbol}. Signal type: ${signalType}. Strength: ${signalStrength}%. Historical accuracy: ${(historicalAccuracy * 100).toFixed(1)}%. Recommended action with standard risk controls.`;
      } else {
        recommendation = `MODERATE-CONFIDENCE signal for ${symbol}. Consider reduced position size. Signal strength: ${signalStrength}%. Use tight stop-loss controls.`;
      }
    } else {
      recommendation = `LOW-CONFIDENCE signal for ${symbol}. Signal strength (${signalStrength}%) below your threshold (${(confidenceThreshold * 100).toFixed(0)}%). Recommend waiting for stronger confirmation.`;
    }

    // Add risk context
    if (shouldAct) {
      recommendation += ` Risk management will apply standard 3% stop-loss and position sizing rules.`;
    }

    const analysis = {
      signal_strength: signalStrength,
      signal_type: signalType,
      symbol: symbol,
      combined_confidence: combinedConfidence,
      confidence_threshold: confidenceThreshold,
      historical_accuracy: historicalAccuracy,
      should_act: shouldAct,
      recommendation: recommendation,
      risk_level: combinedConfidence >= 0.8 ? 'medium' : combinedConfidence >= 0.6 ? 'moderate' : 'high'
    };

    return new Response(JSON.stringify({ 
      success: true, 
      analysis,
      message: `Signal analysis completed with risk assessment`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Signal analysis error:', error);
    throw error;
  }
}

async function getRiskExplanation(supabaseClient: any, params: any) {
  const { userId, tradeRequest } = params;
  
  try {
    // This would typically call the assess_trade_risk function and format the explanation
    const riskResponse = await assessTradeRisk(supabaseClient, params);
    const riskData = JSON.parse(await riskResponse.text());
    
    if (!riskData.success) {
      throw new Error('Failed to assess trade risk');
    }

    const explanation = riskData.assessment.explanation;
    
    return new Response(JSON.stringify({ 
      success: true, 
      explanation,
      risk_level: riskData.assessment.riskLevel,
      can_execute: riskData.assessment.canExecute,
      message: 'Risk explanation generated successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('❌ Risk explanation error:', error);
    throw error;
  }
}

function generateRiskExplanation(data: any): string {
  const { 
    riskLevel, 
    riskFactors, 
    canExecute, 
    stopLoss, 
    takeProfit, 
    maxLoss, 
    dailyStats, 
    riskLimits,
    tradeRequest 
  } = data;

  let explanation = `RISK ASSESSMENT for ${tradeRequest.cryptocurrency} ${tradeRequest.action.toUpperCase()} trade:\n\n`;
  
  explanation += `🎯 RISK LEVEL: ${riskLevel.toUpperCase()}\n`;
  explanation += `💰 TRADE VALUE: €${(tradeRequest.amount * tradeRequest.price).toFixed(2)}\n`;
  explanation += `🛑 STOP LOSS: €${stopLoss.toFixed(2)}\n`;
  
  if (takeProfit) {
    explanation += `📈 TAKE PROFIT: €${takeProfit.toFixed(2)}\n`;
  }
  
  explanation += `⚠️  MAX LOSS: €${maxLoss.toFixed(2)}\n\n`;
  
  explanation += `📊 TODAY'S ACTIVITY:\n`;
  explanation += `• Trades executed: ${dailyStats.trades}/${riskLimits.maxTradesPerDay}\n`;
  explanation += `• Daily P&L: €${dailyStats.pnl.toFixed(2)}\n\n`;
  
  if (riskFactors.length > 0) {
    explanation += `⚠️  RISK FACTORS:\n`;
    riskFactors.forEach((factor: string) => {
      explanation += `• ${factor}\n`;
    });
    explanation += '\n';
  }
  
  explanation += `🎯 DECISION: ${canExecute ? 'APPROVED' : 'BLOCKED'}\n`;
  
  if (!canExecute) {
    explanation += `Reason: Risk limits exceeded. Please review your risk settings or wait until limits reset.\n`;
  } else {
    explanation += `Trade approved with risk controls. Stop loss will limit maximum loss to €${maxLoss.toFixed(2)}.\n`;
  }

  return explanation;
}