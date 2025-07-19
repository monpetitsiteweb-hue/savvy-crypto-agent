import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Play, Settings } from 'lucide-react';

interface NoActiveStrategyStateProps {
  onCreateStrategy?: () => void;
  onActivateStrategy?: () => void;
  className?: string;
}

export const NoActiveStrategyState = ({ 
  onCreateStrategy, 
  onActivateStrategy,
  className = ""
}: NoActiveStrategyStateProps) => {
  return (
    <Card className={`p-8 text-center bg-gradient-to-br from-surface/50 to-background border-border/50 ${className}`}>
      <div className="flex flex-col items-center space-y-6">
        <div className="rounded-full bg-warning/10 p-4">
          <AlertCircle className="h-12 w-12 text-warning" />
        </div>
        
        <div className="space-y-3">
          <h3 className="text-xl font-semibold text-foreground">
            No Strategy Currently Active
          </h3>
          <p className="text-muted-foreground max-w-md">
            Enable a strategy in Test Mode or Live Mode to begin automated trading 
            and see your portfolio performance.
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3">
          {onCreateStrategy && (
            <Button 
              onClick={onCreateStrategy}
              className="bg-primary hover:bg-primary/90"
            >
              <Settings className="h-4 w-4 mr-2" />
              Create Strategy
            </Button>
          )}
          
          {onActivateStrategy && (
            <Button 
              variant="outline" 
              onClick={onActivateStrategy}
              className="border-primary/20 hover:border-primary/40"
            >
              <Play className="h-4 w-4 mr-2" />
              Activate Existing Strategy
            </Button>
          )}
        </div>
        
        <div className="text-sm text-muted-foreground">
          Waiting for strategy activation...
        </div>
      </div>
    </Card>
  );
};