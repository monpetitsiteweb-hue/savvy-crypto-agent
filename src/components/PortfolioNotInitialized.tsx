import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface PortfolioNotInitializedProps {
  onReset: () => void;
  isLoading?: boolean;
}

export function PortfolioNotInitialized({ onReset, isLoading }: PortfolioNotInitializedProps) {
  return (
    <Card className="bg-slate-800/50 border-amber-500/30">
      <CardContent className="p-6">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-400" />
          <div>
            <h3 className="text-lg font-semibold text-white">Portfolio Not Initialized</h3>
            <p className="text-sm text-slate-400 mt-1">
              Your portfolio capital has not been set up yet. Click the button below to initialize with €30,000 starting capital.
            </p>
          </div>
          <Button 
            onClick={onReset} 
            disabled={isLoading}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            {isLoading ? 'Initializing...' : 'Initialize Portfolio'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
