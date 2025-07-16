import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
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
  is_active: boolean;
  created_at: string;
}

export const ConversationPanel = () => {
  console.log('ConversationPanel component loaded');
  const { user } = useAuth();
  const { testMode } = useTestMode();
  const { executeProductionTrade, validateProductionReadiness, isProcessing } = useProductionTrading();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'ai',
      content: testMode 
        ? "Hello! I'm your AI trading assistant in **TEST MODE** 🧪. I can help you practice trading safely with mock money, analyze strategies, and provide advice. Try asking me to 'buy 1000 euros of BTC' or 'change stop loss to 2.5%' - all trades will be simulated!"
        : "Hello! I'm your AI trading assistant. Currently in LIVE MODE - production trading is under development. Please enable Test Mode to safely practice trading features. I can analyze your strategies and provide trading advice!",
      timestamp: new Date()
    }
  ]);
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

  const analyzeUserQuestion = (question: string): string => {
    const lowerQuestion = question.toLowerCase();
    const activeStrategy = userStrategies.find(s => s.is_active);
    
    if (!activeStrategy) {
      return "I notice you don't have an active trading strategy yet. I'd recommend creating one first by clicking 'Create New Strategy' in the Strategy tab. Once you have a strategy configured, I'll be able to provide detailed analysis and suggestions based on your specific settings.";
    }

    const config = activeStrategy.configuration || {};
    
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
    
    // Parse trade requests like "buy 1000 euros of BTC" or "sell 0.5 ETH"
    const buyMatch = lowerMessage.match(/buy\s+(\d+(?:\.\d+)?)\s+(?:euros?|eur|€)\s+(?:of\s+)?([a-z]{3,4})/i);
    const sellMatch = lowerMessage.match(/sell\s+(\d+(?:\.\d+)?)\s+([a-z]{3,4})/i);
    
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
    
    return null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

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

    // Check if this is a trade request and we're not in test mode
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

    try {
      const activeStrategy = userStrategies.find(s => s.is_active);
      
      console.log('Calling AI assistant with:', {
        message: currentInput,
        userId: user?.id,
        strategyId: activeStrategy?.id,
        hasConfig: !!activeStrategy?.configuration
      });
      
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
          
          // Check for specific error patterns
          if (aiError.message && aiError.message.includes('Edge Function returned a non-2xx status code')) {
            errorDetails += `\n**Debug Information:**\n`;
            errorDetails += `- The Coinbase Sandbox API is currently unreachable\n`;
            errorDetails += `- This may be a temporary connectivity issue\n`;
            errorDetails += `- API endpoint: api.sandbox.coinbase.com\n`;
            errorDetails += `- Test Mode: ${testMode ? 'Enabled' : 'Disabled'}\n`;
            errorDetails += `- Try again in a few minutes or contact support if the issue persists\n`;
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
        aiMessage = analyzeUserQuestion(currentInput);
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
        content: analyzeUserQuestion(currentInput),
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
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full flex flex-col">
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
            ? `Analyzing your ${userStrategies.filter(s => s.is_active).length > 0 ? 'active' : ''} trading strategies`
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

      {/* Messages - Scrollable Area */}
      <div className="flex-1 overflow-y-auto min-h-0">
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
      </div>

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