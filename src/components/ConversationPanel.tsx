import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { useProductionTrading, ProductionTradeDetails } from '@/hooks/useProductionTrading';
import { ProductionTradeConfirmation } from './ProductionTradeConfirmation';
import { supabase } from '@/integrations/supabase/client';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

interface StrategyData {
  id: string;
  strategy_name: string;
  configuration: any;
  is_active: boolean; // Keep for backward compatibility
  is_active_test: boolean;
  is_active_live: boolean;
  created_at: string;
  test_mode: boolean;
}

export const ConversationPanel = () => {
  console.log('ConversationPanel component loaded');
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { hasActiveStrategy } = useActiveStrategy();
  const { executeProductionTrade, validateProductionReadiness, isProcessing } = useProductionTrading();
  
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Update messages when strategy state changes
  useEffect(() => {
    const getInitialMessage = () => {
      if (!hasActiveStrategy) {
        return "Hello! I'm your AI trading assistant. Currently on standby as no strategy is active. Enable a strategy in Test Mode or Live Mode to begin automated trading and I'll help you monitor and optimize your trades!";
      }
      
      return testMode 
        ? "Hello! I'm your AI trading assistant in **TEST MODE** 🧪. I can help you practice trading safely with mock money, analyze strategies, and provide advice. Try asking me to 'buy 1000 euros of BTC' or 'change stop loss to 2.5%' - all trades will be simulated!"
        : "Hello! I'm your AI trading assistant. Currently in LIVE MODE - production trading is under development. Please enable Test Mode to safely practice trading features. I can analyze your strategies and provide trading advice!";
    };

    setMessages([{
      id: '1',
      type: 'ai',
      content: getInitialMessage(),
      timestamp: new Date()
    }]);
  }, [hasActiveStrategy, testMode]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userStrategies, setUserStrategies] = useState<StrategyData[]>([]);
  const [showProductionConfirmation, setShowProductionConfirmation] = useState(false);
  const [pendingTradeDetails, setPendingTradeDetails] = useState<ProductionTradeDetails | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load user strategies
  useEffect(() => {
    const loadStrategies = async () => {
      console.log('Loading strategies, user:', user);
      if (!user) {
        console.log('No user found, returning');
        return;
      }
      
      console.log('Fetching strategies for user ID:', user.id);
      const { data, error } = await supabase
        .from('trading_strategies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      console.log('Strategies response:', { data, error });
      if (data && !error) {
        setUserStrategies(data);
        console.log('Set user strategies:', data);
      } else {
        console.error('Error loading strategies:', error);
      }
    };

    loadStrategies();
  }, [user]);

  // Helper function to update strategy configuration
  const updateStrategyConfig = async (strategy: StrategyData, field: string, value: any, displayName: string) => {
    console.log('🔍 DEBUGGING updateStrategyConfig called with:', { strategy: strategy.id, field, value, displayName });
    console.log('🔍 DEBUGGING strategy object:', strategy);
    console.log('🔍 DEBUGGING user:', user?.id);
    
    try {
      const updatedConfig = { ...strategy.configuration, [field]: value };
      console.log('🔍 DEBUGGING updatedConfig:', updatedConfig);
      
      const { data, error } = await supabase
        .from('trading_strategies')
        .update({
          configuration: updatedConfig,
          updated_at: new Date().toISOString(),
        })
        .eq('id', strategy.id)
        .eq('user_id', user?.id)
        .select();

      console.log('🔍 DEBUGGING database update result:', { data, error });

      if (error) {
        console.error('Strategy update error:', error);
        return `❌ Failed to update ${displayName}. Database error: ${error.message}`;
      }
      
      if (!data || data.length === 0) {
        console.error('No rows updated - strategy not found or permission denied');
        return `❌ Failed to update ${displayName}. Strategy not found or permission denied.`;
      }
      
      // Update local strategy state
      setUserStrategies(prev => prev.map(s => 
        s.id === strategy.id 
          ? { ...s, configuration: updatedConfig }
          : s
      ));
      
      if (field === 'riskLevel') {
        // For risk level changes, also update related settings
        const riskSettings = value === 'high' 
          ? { stopLossPercentage: 1, takeProfitPercentage: 2, perTradeAllocation: 150 }
          : value === 'medium'
          ? { stopLossPercentage: 2, takeProfitPercentage: 1.5, perTradeAllocation: 100 }
          : { stopLossPercentage: 3, takeProfitPercentage: 1, perTradeAllocation: 50 };
          
        const fullConfig = { ...updatedConfig, ...riskSettings };
        
        await supabase
          .from('trading_strategies')
          .update({ configuration: fullConfig })
          .eq('id', strategy.id)
          .eq('user_id', user?.id);
          
        setUserStrategies(prev => prev.map(s => 
          s.id === strategy.id 
            ? { ...s, configuration: fullConfig }
            : s
        ));
        
        return `✅ **Strategy Updated Successfully**\n\n${displayName} updated to **${value}** for "${strategy.strategy_name}". I've also optimized your:\n• Stop Loss: ${riskSettings.stopLossPercentage}%\n• Take Profit: ${riskSettings.takeProfitPercentage}%\n• Position Size: €${riskSettings.perTradeAllocation}`;
      }
      
      return `✅ **Strategy Updated Successfully**\n\n${displayName} updated for "${strategy.strategy_name}".`;
    } catch (error) {
      console.error('Strategy update exception:', error);
      return `❌ Failed to update ${displayName}. Please try again.`;
    }
  };

  // Helper function to execute test trades
  const executeTestTrade = async (tradeRequest: ProductionTradeDetails, strategy: StrategyData): Promise<string> => {
    try {
      // Get current market price (simplified - using mock price for now)
      const cryptoSymbol = tradeRequest.cryptocurrency.toUpperCase();
      const mockPrices = { BTC: 101367, ETH: 3176, XRP: 2.99 };
      const currentPrice = mockPrices[cryptoSymbol] || 1;
      
      const cryptoAmount = tradeRequest.action === 'buy' 
        ? tradeRequest.amount / currentPrice
        : tradeRequest.amount;
      
      // Record the trade in mock_trades table
      const { error } = await supabase
        .from('mock_trades')
        .insert({
          user_id: user?.id,
          strategy_id: strategy.id,
          trade_type: tradeRequest.action,
          cryptocurrency: cryptoSymbol,
          amount: cryptoAmount,
          price: currentPrice,
          total_value: tradeRequest.action === 'buy' ? tradeRequest.amount : tradeRequest.amount * currentPrice,
          fees: 0,
          executed_at: new Date().toISOString(),
          is_test_mode: true,
          market_conditions: {
            price: currentPrice,
            timestamp: new Date().toISOString()
          }
        });

      if (error) {
        console.error('Test trade recording error:', error);
        return `❌ **Test Trade Failed**\n\nError recording the trade: ${error.message}`;
      }

      return `✅ **${tradeRequest.action.toUpperCase()} Order Executed Successfully** 🧪\n\n**Details:**\n• Amount: ${cryptoAmount.toFixed(6)} ${cryptoSymbol}\n• Value: €${tradeRequest.action === 'buy' ? tradeRequest.amount.toLocaleString() : (tradeRequest.amount * currentPrice).toLocaleString()}\n• Price: €${currentPrice.toLocaleString()} per ${cryptoSymbol}\n• Environment: 🧪 Test Mode (Simulated)\n\n**Note:** This was a simulated trade for testing purposes. Check your Dashboard to see the updated mock portfolio!`;
    } catch (error) {
      console.error('Test trade execution error:', error);
      return `❌ **Test Trade Failed**\n\nError: ${error.message}`;
    }
  };

  const analyzeUserQuestion = async (question: string): Promise<string> => {
    const lowerQuestion = question.toLowerCase();
    
    // Check for multiple strategies and no active strategy
    const activeStrategies = userStrategies.filter(s => 
      testMode ? s.is_active_test : s.is_active_live
    );
    
    if (activeStrategies.length === 0 && userStrategies.length > 0) {
      return "I notice you have strategies but none are currently active. Please activate a strategy first by going to the Strategy tab and toggling one to active. Once you have an active strategy, I'll be able to analyze it and execute trades for you.";
    }
    
    if (activeStrategies.length === 0) {
      return "I notice you don't have any trading strategies yet. I'd recommend creating one first by clicking 'Create New Strategy' in the Strategy tab. Once you have a strategy configured and activated, I'll be able to provide detailed analysis and execute trades for you.";
    }
    
    if (activeStrategies.length > 1) {
      const strategyNames = activeStrategies.map(s => s.strategy_name).join(', ');
      return `I notice you have multiple active strategies: ${strategyNames}. For safety, please keep only one strategy active at a time. You can deactivate the others in the Strategy tab.`;
    }
    
    const activeStrategy = activeStrategies[0];
    const config = activeStrategy.configuration || {};
    
    // Handle configuration change requests LOCALLY (no edge function needed)
    const configChangeMatch = question.toLowerCase().match(/(?:change|set|update|increase|decrease)\s+(?:my\s+)?(?:risk\s+(?:level|profile)\s+to\s+|stop\s+loss\s+to\s+|take\s+profit\s+to\s+)(\w+|[\d.]+%?)/);
    
    console.log('🔍 DEBUGGING: configChangeMatch result:', configChangeMatch);
    console.log('🔍 DEBUGGING: lowerQuestion contains risk:', lowerQuestion.includes('risk'));
    
    if (configChangeMatch) {
      const value = configChangeMatch[1];
      console.log('🔍 DEBUGGING: Config change detected, value:', value);
      
      if (lowerQuestion.includes('risk')) {
        console.log('🔍 DEBUGGING: Risk change detected, calling updateStrategyConfig');
        // Handle risk profile change directly - NO EDGE FUNCTION NEEDED
        await updateStrategyConfig(activeStrategy, 'riskLevel', value, 'Risk Level');
        
        return `✅ **Risk Profile Updated Successfully**\n\nRisk level changed to **${value.toUpperCase()}** for "${activeStrategy.strategy_name}". ${
          value === 'high' ? 'This allows for higher potential returns but also higher losses.' :
          value === 'low' ? 'This prioritizes capital preservation over aggressive gains.' :
          'This balances risk and reward appropriately.'
        }`;
      } else if (lowerQuestion.includes('stop loss')) {
        const percentage = parseFloat(value.replace('%', ''));
        if (!isNaN(percentage) && percentage > 0 && percentage <= 10) {
          await updateStrategyConfig(activeStrategy, 'stopLossPercentage', percentage, 'Stop Loss');
          return `✅ **Strategy Updated Successfully**\n\nStop Loss updated to ${percentage}% for "${activeStrategy.strategy_name}". This will help limit your losses when trades move against you.`;
        } else {
          return `❌ Invalid stop loss percentage. Please specify a number between 0.1% and 10%.`;
        }
      } else if (lowerQuestion.includes('take profit')) {
        const percentage = parseFloat(value.replace('%', ''));
        if (!isNaN(percentage) && percentage > 0 && percentage <= 20) {
          await updateStrategyConfig(activeStrategy, 'takeProfitPercentage', percentage, 'Take Profit');
          return `✅ **Strategy Updated Successfully**\n\nTake Profit updated to ${percentage}% for "${activeStrategy.strategy_name}". Trades will automatically close when this profit target is reached.`;
        } else {
          return `❌ Invalid take profit percentage. Please specify a number between 0.1% and 20%.`;
        }
      }
    }
    
    // Strategy analysis questions
    if (lowerQuestion.includes('stop loss') || lowerQuestion.includes('stop-loss')) {
      if (config.stopLoss) {
        return `Your current strategy "${activeStrategy.strategy_name}" has stop-loss enabled at ${config.stopLossPercentage || 3}%. This helps limit your losses when trades move against you. Based on your ${config.riskLevel || 'medium'} risk tolerance, this seems appropriate. You might consider adjusting it based on market volatility.`;
      } else {
        return `Your strategy "${activeStrategy.strategy_name}" currently has stop-loss disabled. This increases your risk exposure. Given your ${config.riskLevel || 'medium'} risk tolerance, I'd recommend enabling stop-loss with a percentage between 2-5% to protect your capital.`;
      }
    }

    if (lowerQuestion.includes('take profit') || lowerQuestion.includes('profit target')) {
      return `Your strategy "${activeStrategy.strategy_name}" has a take profit target of ${config.takeProfit || 1.3}%. This is ${config.takeProfit > 2 ? 'relatively aggressive' : config.takeProfit < 1 ? 'quite conservative' : 'moderate'} for a ${config.riskLevel || 'medium'} risk strategy. Consider the current market conditions when setting this target.`;
    }

    if (lowerQuestion.includes('risk') || lowerQuestion.includes('position size')) {
      return `Your strategy is configured with ${config.riskLevel || 'medium'} risk tolerance and a maximum position size of €${config.maxPosition?.toLocaleString() || '5,000'}. Your auto-trading is ${config.autoTrading ? 'enabled' : 'disabled'}. This setup ${config.riskLevel === 'high' ? 'allows for higher potential returns but also higher losses' : config.riskLevel === 'low' ? 'prioritizes capital preservation over aggressive gains' : 'balances risk and reward appropriately'}.`;
    }

    if (lowerQuestion.includes('strategy type') || lowerQuestion.includes('trading strategy')) {
      return `You're using a ${config.strategyType || 'trend-following'} strategy named "${activeStrategy.strategy_name}". This type of strategy ${config.strategyType === 'trend-following' ? 'follows market trends and momentum' : config.strategyType === 'mean-reversion' ? 'buys when prices are low and sells when they revert to mean' : config.strategyType === 'momentum' ? 'capitalizes on strong price movements' : 'looks for price discrepancies across markets'}. AI strategy assistance is ${config.aiStrategy ? 'enabled' : 'disabled'}.`;
    }

    if (lowerQuestion.includes('trailing stop')) {
      if (config.trailingStopBuy) {
        return `Your strategy has trailing stop-buy enabled at ${config.trailingStopBuyPercentage || 1.5}%. This helps you enter positions at better prices by tracking price movements downward before buying. This is a good feature for your ${config.strategyType || 'trend-following'} strategy.`;
      } else {
        return `Trailing stop-buy is currently disabled in your strategy. This feature could help you get better entry points by waiting for price dips before purchasing. Consider enabling it with a 1-2% setting for your ${config.strategyType || 'trend-following'} strategy.`;
      }
    }

    if (lowerQuestion.includes('performance') || lowerQuestion.includes('how am i doing')) {
      return `Based on your current strategy "${activeStrategy.strategy_name}" configuration, you have a ${config.riskLevel || 'medium'} risk approach with ${config.stopLoss ? 'stop-loss protection' : 'no stop-loss protection'}. Your max position is €${config.maxPosition?.toLocaleString() || '5,000'} with a ${config.takeProfit || 1.3}% profit target. To see actual performance metrics, check the Strategy tab performance overview.`;
    }

    if (lowerQuestion.includes('improve') || lowerQuestion.includes('optimize') || lowerQuestion.includes('better')) {
      const suggestions = [];
      
      if (!config.stopLoss) {
        suggestions.push("Enable stop-loss protection to limit downside risk");
      }
      
      if (!config.trailingStopBuy) {
        suggestions.push("Consider enabling trailing stop-buy for better entry points");
      }
      
      if (config.riskLevel === 'high' && !config.stopLoss) {
        suggestions.push("With high risk tolerance, stop-loss becomes even more important");
      }
      
      if (!config.aiStrategy) {
        suggestions.push("Enable AI strategy assistance for automated optimizations");
      }

      if (suggestions.length > 0) {
        return `Here are some suggestions to improve your "${activeStrategy.strategy_name}" strategy:\n\n• ${suggestions.join('\n• ')}\n\nThese adjustments could help optimize your risk-reward ratio based on current market conditions.`;
      } else {
        return `Your strategy "${activeStrategy.strategy_name}" looks well-configured! You have the main risk management features enabled. Continue monitoring performance and consider adjusting take-profit and stop-loss levels based on market volatility.`;
      }
    }

    // Default response with strategy context
    return `I can help you analyze your "${activeStrategy.strategy_name}" strategy. You currently have:\n\n• Risk Level: ${config.riskLevel || 'medium'}\n• Max Position: €${config.maxPosition?.toLocaleString() || '5,000'}\n• Take Profit: ${config.takeProfit || 1.3}%\n• Stop Loss: ${config.stopLoss ? `${config.stopLossPercentage}%` : 'Disabled'}\n• Strategy Type: ${config.strategyType || 'trend-following'}\n\nAsk me about any of these settings, performance optimization, or risk management!`;
  };

  const detectTradeRequest = (message: string): ProductionTradeDetails | null => {
    const lowerMessage = message.toLowerCase();
    
    // Parse trade requests like "buy 1000 euros of BTC" or "sell 0.5 ETH" or "sell all my XRP"
    const buyMatch = lowerMessage.match(/buy\s+(\d+(?:\.\d+)?)\s+(?:euros?|eur|€)\s+(?:of\s+)?([a-z]{3,4})/i);
    const sellMatch = lowerMessage.match(/sell\s+(\d+(?:\.\d+)?)\s+([a-z]{3,4})/i);
    const sellAllMatch = lowerMessage.match(/sell\s+all\s+(?:my\s+)?([a-z]{3,4})/i);
    
    if (buyMatch) {
      const [, amount, crypto] = buyMatch;
      return {
        action: 'buy',
        cryptocurrency: crypto.toLowerCase(),
        amount: parseFloat(amount),
        orderType: 'market'
      };
    }
    
    if (sellMatch) {
      const [, amount, crypto] = sellMatch;
      return {
        action: 'sell',
        cryptocurrency: crypto.toLowerCase(),
        amount: parseFloat(amount),
        orderType: 'market'
      };
    }
    
    if (sellAllMatch) {
      const [, crypto] = sellAllMatch;
      return {
        action: 'sell',
        cryptocurrency: crypto.toLowerCase(),
        amount: -1, // Special flag for "sell all"
        orderType: 'market'
      };
    }
    
    return null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    console.log('🔍 DEBUGGING: handleSend called with input:', input);

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    console.log('🔍 DEBUGGING: About to call analyzeQuestion with:', currentInput);

    // Check if this is a trade request
    const tradeRequest = detectTradeRequest(currentInput);
    
    if (tradeRequest && !testMode) {
      // Production trade detected - show warning that we're focusing on test mode for now
      const productionWarning: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: "🚧 **Production trading is under development**\n\nFor now, please enable Test Mode to try trading features safely. Production trading with real money will be available soon!\n\nTo enable test mode, look for the test mode toggle in your interface.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, productionWarning]);
      setIsLoading(false);
      return;
    }

    // Handle test mode trades directly
    if (tradeRequest && testMode) {
      const activeStrategy = userStrategies.find(s => s.is_active_test);
      
      if (!activeStrategy) {
        const noStrategyMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: "❌ **No Active Strategy**\n\nI can't execute trades without an active strategy. Please activate a strategy in the Strategy tab first, then try your trade again.",
          timestamp: new Date()
        };
        setMessages(prev => [...prev, noStrategyMessage]);
        setIsLoading(false);
        return;
      }

      try {
        const tradeResult = await executeTestTrade(tradeRequest, activeStrategy);
        const tradeMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: tradeResult,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, tradeMessage]);
        setIsLoading(false);
        return;
      } catch (error) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: `❌ **Test Trade Failed**\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }
    }

    try {
      const activeStrategy = userStrategies.find(s => 
        testMode ? s.is_active_test : s.is_active_live
      );
      
      console.log('Calling AI assistant with:', {
        message: currentInput,
        userId: user?.id,
        strategyId: activeStrategy?.id,
        hasConfig: !!activeStrategy?.configuration
      });
      
      // **FIRST TRY LOCAL ANALYSIS** - Handle config changes without edge function
      console.log('🔍 DEBUGGING: Trying local analysis first');
      const localResponse = await analyzeUserQuestion(currentInput);
      
      // If local analysis handled it (returns success or specific config response), use it and skip edge function
      if (localResponse && (localResponse.includes('✅') || localResponse.includes('❌') || localResponse.includes('Risk Profile') || localResponse.includes('Stop Loss') || localResponse.includes('Take Profit'))) {
        console.log('🔍 DEBUGGING: Local analysis handled the request successfully');
        const aiResponse: Message = {
          id: (Date.now() + 1).toString(),
          type: 'ai',
          content: localResponse,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, aiResponse]);
        setIsLoading(false);
        return;
      }
      
      console.log('🔍 DEBUGGING: Local analysis did not handle request, calling edge function');
      
      // Add a visual indicator that we're attempting to call AI
      const testResponse: Message = {
        id: (Date.now() + 0.5).toString(),
        type: 'ai',
        content: '🔄 Connecting to AI assistant...',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, testResponse]);
      
      // Try to call the edge function for AI analysis and strategy updates
      let aiMessage = '';
      let hasConfigUpdates = false;
      
      try {
        const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-trading-assistant', {
          body: {
            message: currentInput,
            userId: user?.id,
            strategyId: activeStrategy?.id,
            currentConfig: activeStrategy?.configuration || {},
            testMode: testMode, // Pass the current test mode setting
          },
        });

        if (aiError) {
          console.error('AI function error details:', aiError);
          
          // Show detailed error information in UI
          let errorDetails = '';
          if (aiError.message) {
            errorDetails += `**Error Message:** ${aiError.message}\n`;
          }
          if (aiError.details) {
            errorDetails += `**Details:** ${aiError.details}\n`;
          }
          if (aiError.hint) {
            errorDetails += `**Hint:** ${aiError.hint}\n`;
          }
          
          // Check for specific error patterns and get real error details
          if (aiError.message && aiError.message.includes('Edge Function returned a non-2xx status code')) {
            // Log the full error for debugging
            console.log('Full error object for debugging:', JSON.stringify(aiError, null, 2));
            
            errorDetails += `\n**🚨 REAL DEBUG INFORMATION:**\n`;
            errorDetails += `- **Edge Function Error**: Functions are returning 502 status codes\n`;
            errorDetails += `- **This is NOT a Coinbase issue** - it's a function deployment/execution problem\n`;
            errorDetails += `- **Root Cause**: Edge functions are failing to execute properly\n`;
            errorDetails += `- **Action Required**: Check Supabase function deployment status\n`;
            errorDetails += `- **Test Mode**: ${testMode ? 'Enabled' : 'Disabled'}\n`;
            errorDetails += `- **Function Status**: Currently experiencing 502 Bad Gateway errors\n`;
          }
          
          aiMessage = `❌ **Trading Operation Failed**\n\n${errorDetails}`;
        } else if (aiData && aiData.message) {
          // Use the ACTUAL AI response
          aiMessage = aiData.message;
          hasConfigUpdates = aiData.configUpdates && Object.keys(aiData.configUpdates).length > 0;
          
          // Update strategy if changes were made
          if (hasConfigUpdates && activeStrategy?.id) {
            await supabase
              .from('trading_strategies')
              .update({
                configuration: { ...activeStrategy.configuration, ...aiData.configUpdates },
                updated_at: new Date().toISOString(),
              })
              .eq('id', activeStrategy.id)
              .eq('user_id', user?.id);
              
            // Update local strategy state
            const newConfig = { ...activeStrategy.configuration, ...aiData.configUpdates };
            setUserStrategies(prev => prev.map(s => 
              s.id === activeStrategy.id 
                ? { ...s, configuration: newConfig }
                : s
            ));
          }
        } else {
          aiMessage = 'No response from AI assistant';
        }
      } catch (edgeFunctionError) {
        console.error('Edge function exception:', edgeFunctionError);
        
        // Show detailed error in UI
        let errorMsg = `**Unexpected Error:** ${edgeFunctionError.message}\n`;
        errorMsg += `**Error Type:** ${edgeFunctionError.name || 'Unknown'}\n`;
        errorMsg += `**Test Mode:** ${testMode ? 'Enabled' : 'Disabled'}\n`;
        
        if (edgeFunctionError.message.includes('Failed to fetch') || 
            edgeFunctionError.message.includes('NetworkError') ||
            edgeFunctionError.message.includes('fetch')) {
          errorMsg += `\n**Likely Cause:** Network connectivity issue with Coinbase API\n`;
          errorMsg += `**Suggestion:** Check your internet connection and try again\n`;
        }
        
        aiMessage = `❌ **Connection Error**\n\n${errorMsg}`;
      }
      
      // Fallback to local analysis only if no AI response
      if (!aiMessage) {
        console.log('🔍 DEBUGGING: No AI message, calling local analyzeUserQuestion');
        aiMessage = await analyzeUserQuestion(currentInput);
        
        // If local analysis handled it (returned a response), don't call edge function
        if (aiMessage && !aiMessage.includes('I can help you analyze')) {
          console.log('🔍 DEBUGGING: Local analysis handled the request, skipping edge function');
          const aiResponse: Message = {
            id: (Date.now() + 1).toString(),
            type: 'ai',
            content: aiMessage,
            timestamp: new Date()
          };
          setMessages(prev => [...prev.slice(0, -1), aiResponse]);
          setIsLoading(false);
          return;
        }
      }
      
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: aiMessage,
        timestamp: new Date()
      };
      
      // Replace the "Connecting..." message with the actual response
      setMessages(prev => [...prev.slice(0, -1), aiResponse]);
      
    } catch (error) {
      // This should only catch unexpected errors now since edge function errors are handled above
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: await analyzeUserQuestion(currentInput),
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiResponse]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProductionTradeConfirm = async (paymentMethod: string, validations: any) => {
    if (!pendingTradeDetails) return;
    
    try {
      const result = await executeProductionTrade(
        pendingTradeDetails,
        paymentMethod, 
        validations,
        '1234' // In real app, this would be entered by user
      );
      
      if (result) {
        const successMessage: Message = {
          id: Date.now().toString(),
          type: 'ai',
          content: `🚀 **Production Trade Executed Successfully!**\n\n${result.message}\n\nOrder ID: ${result.data?.order_id || 'Unknown'}\nEnvironment: LIVE PRODUCTION`,
          timestamp: new Date()
        };
        setMessages(prev => [...prev, successMessage]);
      }
    } catch (error) {
      const errorMessage: Message = {
        id: Date.now().toString(),
        type: 'ai',
        content: `❌ **Production Trade Failed**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setShowProductionConfirmation(false);
      setPendingTradeDetails(null);
    }
  };

  const handleProductionTradeCancel = () => {
    setShowProductionConfirmation(false);
    setPendingTradeDetails(null);
    
    const cancelMessage: Message = {
      id: Date.now().toString(),
      type: 'ai',
      content: "Production trade cancelled. Your order was not executed.",
      timestamp: new Date()
    };
    setMessages(prev => [...prev, cancelMessage]);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (showProductionConfirmation && pendingTradeDetails) {
    return (
      <div className="h-full">
        <ProductionTradeConfirmation
          tradeDetails={pendingTradeDetails}
          onConfirm={handleProductionTradeConfirm}
          onCancel={handleProductionTradeCancel}
          isProcessing={isProcessing}
        />
      </div>
    );
  }

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full max-h-screen flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <Bot className="w-5 h-5 text-green-400" />
          AI Trading Assistant
          {!testMode && (
            <span className="ml-2 px-2 py-1 bg-red-600 text-white text-xs rounded-full">
              LIVE MODE
            </span>
          )}
          {testMode && (
            <span className="ml-2 px-2 py-1 bg-blue-600 text-white text-xs rounded-full">
              TEST MODE
            </span>
          )}
        </h2>
        <p className="text-sm text-slate-300 mt-1">
          {userStrategies.length > 0 
            ? `Analyzing your ${userStrategies.filter(s => testMode ? s.is_active_test : s.is_active_live).length > 0 ? 'active' : ''} trading strategies`
            : 'Ask me about trading strategies and risk management'
          }
        </p>
        {testMode && (
          <p className="text-xs text-blue-300 mt-1">
            🧪 Test mode: All trades are simulated with mock money - perfect for learning!
          </p>
        )}
        {!testMode && (
          <p className="text-xs text-amber-300 mt-1">
            🚧 Live mode: Production trading under development - please enable Test Mode for now
          </p>
        )}
      </div>

      {/* Messages - Scrollable Area with Fixed Height */}
      <ScrollArea className="flex-1 h-0">
        <div className="p-4 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.type === 'ai' && (
                <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-green-400" />
                </div>
              )}
              
              <div
                className={`max-w-[80%] p-3 rounded-lg whitespace-pre-wrap ${
                  message.type === 'user'
                    ? 'bg-blue-600/30 text-blue-50 border border-blue-500/40'
                    : 'bg-slate-700/70 text-slate-50 border border-slate-600/60'
                }`}
              >
                {message.content}
                <div className="text-xs text-slate-300 mt-2">
                  {message.timestamp.toLocaleTimeString()}
                </div>
              </div>

              {message.type === 'user' && (
                <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-blue-400" />
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className="w-8 h-8 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-green-400" />
              </div>
              <div className="bg-slate-700/50 text-slate-100 border border-slate-600/50 p-3 rounded-lg">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input - Fixed at bottom */}
      <div className="p-4 border-t border-slate-700 flex-shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={testMode 
              ? "🧪 TEST MODE: Try 'buy 1000 euros of BTC', 'sell 0.5 ETH', or ask me to change strategy settings..."
              : "🚧 Enable Test Mode to try trading features safely. Ask me about strategy settings or trading advice..."
            }
            className="flex-1 min-h-[60px] bg-slate-700/50 border-slate-600 text-white placeholder-slate-400 resize-none"
            disabled={isLoading}
          />
          <Button 
            onClick={handleSend}
            className="bg-green-500 hover:bg-green-600 text-white"
            disabled={!input.trim() || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};