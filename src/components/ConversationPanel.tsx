
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, User } from 'lucide-react';

interface Message {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: Date;
}

export const ConversationPanel = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'ai',
      content: "Hello! I'm your AI trading assistant. I can help you create trading strategies for XRP and other cryptocurrencies. Try telling me something like: 'Buy XRP when RSI drops below 30 and Bitcoin is trending up'",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');

    // Simulate AI response
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: `I understand you want to implement a trading strategy. Let me break this down:\n\n• Strategy: ${input}\n• I'll need to configure RSI monitoring\n• Set up price triggers\n• Define position sizing\n\nShould I proceed with creating this strategy? What's your preferred position size?`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur-sm rounded-xl border border-slate-700 h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Bot className="w-5 h-5 text-green-400" />
          AI Trading Assistant
        </h2>
        <p className="text-sm text-slate-400 mt-1">Describe your trading strategy in natural language</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-700">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your trading strategy... (e.g., 'Buy XRP when RSI < 30 and volume increases 20%')"
            className="flex-1 min-h-[60px] bg-slate-700/50 border-slate-600 text-white placeholder-slate-400 resize-none"
          />
          <Button 
            onClick={handleSend}
            className="bg-green-500 hover:bg-green-600 text-white"
            disabled={!input.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
