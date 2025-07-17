import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Wand2, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface ParsedStrategy {
  strategy_name: string;
  description: string;
  configuration: any;
  required_categories: string[];
  risk_level: string;
  complexity: string;
  parsing_metadata: {
    original_prompt: string;
    available_categories: string[];
    missing_categories: string[];
    available_sources: number;
    confidence: number;
  };
}

interface NaturalLanguageStrategyProps {
  onStrategyParsed: (strategy: ParsedStrategy) => void;
  onCancel: () => void;
}

const NaturalLanguageStrategy: React.FC<NaturalLanguageStrategyProps> = ({
  onStrategyParsed,
  onCancel
}) => {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [parsedStrategy, setParsedStrategy] = useState<ParsedStrategy | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  const examplePrompts = [
    "Buy XRP every time Bitcoin drops more than 2% in 24 hours and social sentiment is bullish on XRP.",
    "Sell 10% of ETH holdings whenever Fear & Greed Index goes below 30.",
    "Buy €100 worth of BTC weekly if BTC price is under its 7-day moving average.",
    "I want a low-risk strategy on stablecoins to buy and sell frequently to gain 1.5% per day.",
    "Stop trading if wallet drawdown exceeds 10% in a 7-day window."
  ];

  const handleParse = async () => {
    if (!prompt.trim() || !user) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-strategy', {
        body: { prompt: prompt.trim(), userId: user.id }
      });

      if (error) throw error;

      setParsedStrategy(data);
      toast({
        title: "Strategy Parsed",
        description: `Successfully parsed: ${data.strategy_name}`,
      });
    } catch (error) {
      console.error('Error parsing strategy:', error);
      toast({
        title: "Parsing Failed",
        description: "Failed to parse strategy. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAcceptStrategy = () => {
    if (parsedStrategy) {
      onStrategyParsed(parsedStrategy);
    }
  };

  const getRiskLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
      case 'low': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'high': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            Natural Language Strategy Builder
          </CardTitle>
          <CardDescription>
            Describe your trading strategy in plain English and let AI convert it to a structured configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Strategy Description</label>
            <Textarea
              placeholder="Describe your trading strategy in natural language..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Example Prompts</label>
            <div className="grid gap-2">
              {examplePrompts.map((example, index) => (
                <button
                  key={index}
                  onClick={() => setPrompt(example)}
                  className="text-left p-2 text-sm bg-muted rounded hover:bg-muted/80 transition-colors"
                >
                  "{example}"
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={handleParse} 
              disabled={!prompt.trim() || isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Parsing Strategy...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  Parse Strategy
                </>
              )}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      {parsedStrategy && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Parsed Strategy: {parsedStrategy.strategy_name}</span>
              <div className="flex gap-2">
                <Badge className={getRiskLevelColor(parsedStrategy.risk_level)}>
                  {parsedStrategy.risk_level} risk
                </Badge>
                <Badge variant="outline">
                  {parsedStrategy.complexity}
                </Badge>
              </div>
            </CardTitle>
            <CardDescription>
              {parsedStrategy.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Required Categories */}
            <div>
              <h4 className="font-medium mb-2">Required Data Categories</h4>
              <div className="flex flex-wrap gap-2">
                {parsedStrategy.required_categories.map((category) => (
                  <Badge 
                    key={category} 
                    variant={
                      parsedStrategy.parsing_metadata.available_categories.includes(category) 
                        ? "default" 
                        : "destructive"
                    }
                  >
                    {category}
                    {parsedStrategy.parsing_metadata.available_categories.includes(category) ? (
                      <CheckCircle className="ml-1 h-3 w-3" />
                    ) : (
                      <AlertTriangle className="ml-1 h-3 w-3" />
                    )}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Warnings for missing categories */}
            {parsedStrategy.parsing_metadata.missing_categories.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Missing data categories: {parsedStrategy.parsing_metadata.missing_categories.join(', ')}. 
                  You may need to enable these in the admin panel for the strategy to work optimally.
                </AlertDescription>
              </Alert>
            )}

            {/* Strategy Configuration Preview */}
            <div>
              <h4 className="font-medium mb-2">Strategy Configuration Preview</h4>
              <div className="bg-muted p-3 rounded text-sm">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(parsedStrategy.configuration, null, 2)}
                </pre>
              </div>
            </div>

            {/* Confidence Score */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Parsing Confidence: {Math.round(parsedStrategy.parsing_metadata.confidence * 100)}%</span>
              <span>Available Sources: {parsedStrategy.parsing_metadata.available_sources}</span>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleAcceptStrategy} className="flex-1">
                Use This Strategy
              </Button>
              <Button variant="outline" onClick={() => setParsedStrategy(null)}>
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default NaturalLanguageStrategy;