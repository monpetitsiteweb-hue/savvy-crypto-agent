import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useMockWallet } from "@/hooks/useMockWallet";
import { useTestMode } from "@/hooks/useTestMode";
import { Wallet, TrendingUp, TrendingDown } from "lucide-react";

export const MockWalletDisplay = () => {
  const { testMode } = useTestMode();
  const { balances, getTotalValue } = useMockWallet();

  if (!testMode || balances.length === 0) {
    return null;
  }

  const totalValue = getTotalValue();

  return (
    <Card className="border-orange-500/20 bg-slate-800/50 border-slate-600">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-orange-400">
          <Wallet className="h-5 w-5" />
          Test Wallet
          <Badge variant="secondary" className="bg-orange-500/20 text-orange-400 border-orange-500/30">
            Mock Data
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
            <span className="font-medium text-white">Total Portfolio Value</span>
            <span className="text-xl font-bold text-green-400">€{totalValue.toLocaleString()}</span>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {balances.map((balance) => (
              <div key={balance.currency} className="p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-300">
                    {balance.currency}
                  </span>
                  {balance.currency !== 'EUR' && (
                    <div className="flex items-center gap-1">
                      {Math.random() > 0.5 ? (
                        <TrendingUp className="h-3 w-3 text-green-400" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-400" />
                      )}
                    </div>
                  )}
                </div>
                <div className="mt-1">
                  <div className="font-bold text-white">
                    {balance.amount.toLocaleString(undefined, {
                      maximumFractionDigits: balance.currency === 'EUR' ? 2 : 
                                           balance.currency === 'XRP' ? 0 : 4
                    })}
                  </div>
                  {balance.currency !== 'EUR' && (
                    <div className="text-xs text-slate-400">
                      ≈ €{balance.value_in_base.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};