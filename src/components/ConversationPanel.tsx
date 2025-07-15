import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
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
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'ai',
      content: "Hello! I'm your AI trading assistant. I can analyze your strategies, modify your settings in real-time, and provide trading advice based on current market signals and trends. Try asking me to 'change stop loss to 2.5%' or 'give me trading advice'!",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userStrategies, setUserStrategies] = useState<StrategyData[]>([]);
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
          },
        });

        if (aiError) {
          aiMessage = `❌ Edge function error: ${JSON.stringify(aiError)}`;
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
        aiMessage = `Function error: ${edgeFunctionError.message}`;
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 h-full flex flex-col max-h-[calc(100vh-180px)]">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Bot className="w-5 h-5 text-green-400" />
          AI Trading Assistant
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          {userStrategies.length > 0 
            ? `Analyzing your ${userStrategies.filter(s => s.is_active).length > 0 ? 'active' : ''} trading strategies`
            : 'Ask me about trading strategies and risk management'
          }
        </p>
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
                    ? 'bg-blue-500/20 text-blue-100 border border-blue-500/30'
                    : 'bg-slate-700/50 text-slate-100 border border-slate-600/50'
                }`}
              >
                {message.content}
                <div className="text-xs text-slate-400 mt-2">
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
            placeholder="Ask me to change settings or get trading advice... (e.g., 'change stop loss to 2.5%', 'give me trading advice')"
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