/**
 * RealPortfolioDisplay - REAL mode version of UnifiedPortfolioDisplay
 * 
 * Shows REAL on-chain positions from real_positions_view.
 * 
 * WHAT THIS SHOWS:
 * - Positions with quantity ONLY
 * - Symbol and chain info
 * 
 * WHAT THIS DOES NOT SHOW (TEST-only):
 * - Cash balance
 * - Portfolio value
 * - Unrealized P&L
 * - Realized P&L
 * - Performance metrics
 * - Gas estimates
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Wallet } from "lucide-react";
import { useRealPositions } from "@/hooks/useRealPositions";
import { RealPositionsTable } from "@/components/trading/RealPositionsTable";
import { PortfolioNotInitialized } from "@/components/PortfolioNotInitialized";

export function RealPortfolioDisplay() {
  const { positions, isLoading, error, refresh } = useRealPositions();

  // If error, show message
  if (error) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardContent className="p-6">
          <div className="text-center text-red-400">
            <p>Error loading positions: {error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // If no positions and not loading, show "not initialized" state
  if (!isLoading && positions.length === 0) {
    return (
      <Card className="bg-slate-800 border-slate-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5" />
              Portfolio
              <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                REAL (on-chain)
              </Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-center text-slate-400 py-8">
            <Wallet className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No on-chain positions</p>
            <p className="text-sm mt-2">Execute a REAL trade to see positions here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Wallet className="h-5 w-5" />
            Portfolio
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
              REAL (on-chain)
            </Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Info banner: Quantity only */}
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <p className="text-xs text-amber-400">
            <strong>REAL Mode:</strong> Portfolio value, P&L, and performance metrics are TEST-only. 
            REAL mode shows on-chain position quantities only.
          </p>
        </div>

        {/* Positions table */}
        <RealPositionsTable
          positions={positions}
          isLoading={isLoading}
          onRefresh={refresh}
        />
      </CardContent>
    </Card>
  );
}
