import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Coins, 
  Plus, 
  X, 
  Search, 
  Info,
  TrendingUp,
  DollarSign 
} from 'lucide-react';

const COINBASE_COINS = [
  'BTC', 'ETH', 'ADA', 'DOGE', 'XRP', 'LTC', 'BCH', 'LINK', 'DOT', 'UNI',
  'SOL', 'MATIC', 'AVAX', 'ICP', 'XLM', 'VET', 'ALGO', 'ATOM', 'FIL', 'TRX',
  'ETC', 'THETA', 'XMR', 'XTZ', 'COMP', 'AAVE', 'MKR', 'SNX', 'CRV', 'YFI'
];

interface CoinsAmountsPanelProps {
  formData: any;
  updateFormData: (field: string, value: any) => void;
}

const TooltipField = ({ 
  children, 
  description, 
  examples 
}: { 
  children: React.ReactNode; 
  description: string;
  examples?: string[];
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div className="flex items-center gap-2">
        {children}
        <Info className="h-4 w-4 text-muted-foreground hover:text-foreground cursor-help" />
      </div>
    </TooltipTrigger>
    <TooltipContent className="max-w-sm p-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">{description}</p>
        {examples && examples.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground font-medium">Say:</p>
            <div className="space-y-1">
              {examples.map((example, index) => (
                <p key={index} className="text-xs text-muted-foreground italic">
                  "{example}"
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </TooltipContent>
  </Tooltip>
);

export const CoinsAmountsPanel = ({ formData, updateFormData }: CoinsAmountsPanelProps) => {
  const [coinSearch, setCoinSearch] = useState('');
  
  const availableCoins = COINBASE_COINS.filter(coin => 
    !formData.selectedCoins.includes(coin) &&
    coin.toLowerCase().includes(coinSearch.toLowerCase())
  );

  const addCoin = (coin: string) => {
    const newSelectedCoins = [...formData.selectedCoins, coin];
    updateFormData('selectedCoins', newSelectedCoins);
  };

  const removeCoin = (coin: string) => {
    const newSelectedCoins = formData.selectedCoins.filter((c: string) => c !== coin);
    updateFormData('selectedCoins', newSelectedCoins);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            Coins and Amounts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Available Coins */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Available Coins</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search coins..."
                    value={coinSearch}
                    onChange={(e) => setCoinSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              
              <div className="border rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                {availableCoins.map((coin) => (
                  <div
                    key={coin}
                    className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer"
                    onClick={() => addCoin(coin)}
                  >
                    <span className="font-medium">{coin}</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {availableCoins.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {coinSearch ? 'No coins found' : 'All coins selected'}
                  </p>
                )}
              </div>
            </div>

            {/* Selected Coins */}
            <div className="space-y-4">
              <TooltipField description="These are the cryptocurrencies your strategy will trade." examples={["Trade Bitcoin and Ethereum", "Add Solana to my portfolio", "Include XRP in the strategy"]}>
                <Label>Selected Coins ({formData.selectedCoins.length})</Label>
              </TooltipField>
              
              <div className="border rounded-lg p-4 max-h-64 overflow-y-auto">
                {formData.selectedCoins.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No coins selected. Add coins from the left panel.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {formData.selectedCoins.map((coin: string) => (
                      <div
                        key={coin}
                        className="flex items-center justify-between p-2 bg-muted rounded"
                      >
                        <Badge variant="secondary">{coin}</Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          onClick={() => removeCoin(coin)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField description="Maximum number of different cryptocurrencies that can be actively traded at once." examples={["Focus on 3 coins max", "Trade up to 5 cryptos simultaneously", "Limit to 2 active coins"]}>
                <Label>Max Active Coins</Label>
              </TooltipField>
              <div className="space-y-2">
                <Slider
                  min={1}
                  max={10}
                  step={1}
                  value={[formData.maxActiveCoins]}
                  onValueChange={(value) => updateFormData('maxActiveCoins', value[0])}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span className="font-medium">{formData.maxActiveCoins} coins</span>
                  <span>10</span>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 border rounded-lg">
              <TooltipField description="Let the AI automatically choose which coins to trade based on market conditions." examples={["Auto-select best performing coins", "Let AI pick cryptos for me", "Enable automatic coin selection"]}>
                <Label>Auto Coin Selection</Label>
              </TooltipField>
              <Checkbox 
                checked={formData.enableAutoCoinSelection} 
                onCheckedChange={(value) => updateFormData('enableAutoCoinSelection', value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <TooltipField description="How much money to use per individual trade." examples={["Use 100 euros per trade", "Risk 5% of portfolio per position", "Allocate 50 euros per trade"]}>
                <Label>Amount Per Trade</Label>
              </TooltipField>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={formData.perTradeAllocation}
                  onChange={(e) => updateFormData('perTradeAllocation', parseFloat(e.target.value) || 0)}
                  className="flex-1"
                />
                <Select 
                  value={formData.allocationUnit} 
                  onValueChange={(value) => updateFormData('allocationUnit', value)}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="euro">€</SelectItem>
                    <SelectItem value="percentage">%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

          </div>

          {formData.buyFrequency === 'interval' && (
            <div className="space-y-2">
              <TooltipField description="Minutes between automated buy orders when using interval buying." examples={["Buy every hour", "Space trades 30 minutes apart", "Trade every 90 minutes"]}>
                <Label>Buy Interval (minutes)</Label>
              </TooltipField>
              <Input
                type="number"
                value={formData.buyIntervalMinutes}
                onChange={(e) => updateFormData('buyIntervalMinutes', parseInt(e.target.value) || 60)}
                min={1}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};