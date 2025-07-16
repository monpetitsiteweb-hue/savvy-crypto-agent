import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, CreditCard, Euro, DollarSign, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";

interface TradeDetails {
  action: 'buy' | 'sell';
  cryptocurrency: string;
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

interface ProductionTradeConfirmationProps {
  tradeDetails: TradeDetails;
  onConfirm: (paymentMethod: string, validations: ValidationSteps) => void;
  onCancel: () => void;
  isProcessing: boolean;
}

interface ValidationSteps {
  riskAcknowledged: boolean;
  amountConfirmed: boolean;
  orderTypeConfirmed: boolean;
  tradingFeesAcknowledged: boolean;
  marketRisksAcknowledged: boolean;
  twoFactorEnabled?: boolean;
}

export const ProductionTradeConfirmation: React.FC<ProductionTradeConfirmationProps> = ({
  tradeDetails,
  onConfirm,
  onCancel,
  isProcessing
}) => {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [currentStep, setCurrentStep] = useState(1);
  const [validations, setValidations] = useState<ValidationSteps>({
    riskAcknowledged: false,
    amountConfirmed: false,
    orderTypeConfirmed: false,
    tradingFeesAcknowledged: false,
    marketRisksAcknowledged: false,
    twoFactorEnabled: false
  });
  const [confirmAmount, setConfirmAmount] = useState('');
  const [pin, setPin] = useState('');

  const paymentMethods = [
    { id: 'eur_wallet', label: 'EUR Wallet', icon: Euro, description: 'Use your EUR balance' },
    { id: 'usd_wallet', label: 'USD Wallet', icon: DollarSign, description: 'Use your USD balance' },
    { id: 'credit_card', label: 'Credit Card', icon: CreditCard, description: 'Visa/Mastercard' },
    { id: 'paypal', label: 'PayPal', icon: CreditCard, description: 'PayPal account' },
  ];

  const calculateFees = () => {
    const tradingFee = tradeDetails.amount * 0.006; // 0.6% Coinbase Pro fee
    const paymentFee = selectedPaymentMethod === 'credit_card' ? tradeDetails.amount * 0.0349 : 0; // 3.49% for card
    return { tradingFee, paymentFee, total: tradingFee + paymentFee };
  };

  const fees = calculateFees();
  const totalAmount = tradeDetails.amount + fees.total;

  const allValidationsComplete = Object.values(validations).every(v => v === true) && 
    parseFloat(confirmAmount) === tradeDetails.amount &&
    pin.length >= 4;

  const handleValidationChange = (key: keyof ValidationSteps, value: boolean) => {
    setValidations(prev => ({ ...prev, [key]: value }));
  };

  const renderStep1 = () => (
    <div className="space-y-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto h-12 w-12 text-amber-500 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          🚨 LIVE TRADING CONFIRMATION 🚨
        </h3>
        <p className="text-sm text-muted-foreground">
          You are about to place a real trade with actual money on Coinbase Pro
        </p>
      </div>

      <Card className="border-red-200 bg-red-50/50">
        <CardHeader>
          <CardTitle className="text-red-800">⚠️ IMPORTANT RISKS</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="risk-ack" 
                checked={validations.riskAcknowledged}
                onCheckedChange={(checked) => handleValidationChange('riskAcknowledged', checked as boolean)}
              />
              <Label htmlFor="risk-ack" className="text-sm text-red-800">
                I understand that cryptocurrency trading involves significant financial risk and I may lose money
              </Label>
            </div>
            
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="market-risks" 
                checked={validations.marketRisksAcknowledged}
                onCheckedChange={(checked) => handleValidationChange('marketRisksAcknowledged', checked as boolean)}
              />
              <Label htmlFor="market-risks" className="text-sm text-red-800">
                I acknowledge that market prices are volatile and can change rapidly during order execution
              </Label>
            </div>
            
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="fees-ack" 
                checked={validations.tradingFeesAcknowledged}
                onCheckedChange={(checked) => handleValidationChange('tradingFeesAcknowledged', checked as boolean)}
              />
              <Label htmlFor="fees-ack" className="text-sm text-red-800">
                I understand and accept all trading and payment fees (€{fees.total.toFixed(2)} total fees)
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Button 
        onClick={() => setCurrentStep(2)}
        disabled={!validations.riskAcknowledged || !validations.marketRisksAcknowledged || !validations.tradingFeesAcknowledged}
        className="w-full"
      >
        Continue to Trade Details
      </Button>
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            Step 2: Verify Trade Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Action</Label>
              <p className="font-semibold capitalize">{tradeDetails.action} {tradeDetails.cryptocurrency}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Order Type</Label>
              <p className="font-semibold capitalize">{tradeDetails.orderType}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Amount</Label>
              <p className="font-semibold">€{tradeDetails.amount.toFixed(2)}</p>
            </div>
            {tradeDetails.limitPrice && (
              <div>
                <Label className="text-muted-foreground">Limit Price</Label>
                <p className="font-semibold">€{tradeDetails.limitPrice.toFixed(2)}</p>
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-3">
            <Label htmlFor="confirm-amount">Please re-enter the trade amount to confirm:</Label>
            <Input
              id="confirm-amount"
              type="number"
              placeholder="Enter amount in EUR"
              value={confirmAmount}
              onChange={(e) => setConfirmAmount(e.target.value)}
              className={parseFloat(confirmAmount) === tradeDetails.amount ? 'border-green-500' : ''}
            />
            {confirmAmount && parseFloat(confirmAmount) !== tradeDetails.amount && (
              <p className="text-sm text-red-600">Amount does not match. Please enter exactly €{tradeDetails.amount}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="amount-confirmed" 
                checked={validations.amountConfirmed}
                onCheckedChange={(checked) => handleValidationChange('amountConfirmed', checked as boolean)}
              />
              <Label htmlFor="amount-confirmed" className="text-sm">
                I confirm the trade amount of €{tradeDetails.amount.toFixed(2)} is correct
              </Label>
            </div>
            
            <div className="flex items-start space-x-2">
              <Checkbox 
                id="order-confirmed" 
                checked={validations.orderTypeConfirmed}
                onCheckedChange={(checked) => handleValidationChange('orderTypeConfirmed', checked as boolean)}
              />
              <Label htmlFor="order-confirmed" className="text-sm">
                I confirm the {tradeDetails.orderType} order type is what I intended
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setCurrentStep(1)}>
          Back
        </Button>
        <Button 
          onClick={() => setCurrentStep(3)}
          disabled={!validations.amountConfirmed || !validations.orderTypeConfirmed || parseFloat(confirmAmount) !== tradeDetails.amount}
          className="flex-1"
        >
          Continue to Payment
        </Button>
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Step 3: Select Payment Method</CardTitle>
          <CardDescription>Choose how you want to fund this trade</CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
            {paymentMethods.map((method) => (
              <div key={method.id} className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-muted/50">
                <RadioGroupItem value={method.id} id={method.id} />
                <Label htmlFor={method.id} className="flex items-center space-x-3 cursor-pointer flex-1">
                  <method.icon className="h-5 w-5" />
                  <div>
                    <div className="font-medium">{method.label}</div>
                    <div className="text-sm text-muted-foreground">{method.description}</div>
                  </div>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {selectedPaymentMethod && (
        <Card>
          <CardHeader>
            <CardTitle>Cost Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Trade Amount:</span>
                <span>€{tradeDetails.amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Trading Fee (0.6%):</span>
                <span>€{fees.tradingFee.toFixed(2)}</span>
              </div>
              {fees.paymentFee > 0 && (
                <div className="flex justify-between">
                  <span>Payment Fee (3.49%):</span>
                  <span>€{fees.paymentFee.toFixed(2)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>Total Cost:</span>
                <span>€{totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setCurrentStep(2)}>
          Back
        </Button>
        <Button 
          onClick={() => setCurrentStep(4)}
          disabled={!selectedPaymentMethod}
          className="flex-1"
        >
          Continue to Security
        </Button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-green-600" />
            Step 4: Security Verification
          </CardTitle>
          <CardDescription>Final security checks before executing your trade</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label htmlFor="security-pin">Enter your 4-digit trading PIN:</Label>
            <Input
              id="security-pin"
              type="password"
              placeholder="••••"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="text-center text-lg tracking-widest"
            />
            <p className="text-xs text-muted-foreground">
              This PIN helps protect against unauthorized trades
            </p>
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox 
              id="two-factor" 
              checked={validations.twoFactorEnabled}
              onCheckedChange={(checked) => handleValidationChange('twoFactorEnabled', checked as boolean)}
            />
            <Label htmlFor="two-factor" className="text-sm">
              I have verified this trade on my mobile device / 2FA app
            </Label>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <strong>Final Confirmation:</strong> You are about to execute a LIVE trade for €{totalAmount.toFixed(2)} 
          using {paymentMethods.find(m => m.id === selectedPaymentMethod)?.label}. This action cannot be undone.
        </AlertDescription>
      </Alert>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setCurrentStep(3)}>
          Back
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel Trade
        </Button>
        <Button 
          onClick={() => onConfirm(selectedPaymentMethod, validations)}
          disabled={!allValidationsComplete || isProcessing}
          className="flex-1 bg-red-600 hover:bg-red-700"
        >
          {isProcessing ? 'Processing...' : `Execute Live Trade - €${totalAmount.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Live Trading Confirmation</h2>
          <div className="text-sm text-muted-foreground">
            Step {currentStep} of 4
          </div>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div 
            className="bg-primary h-2 rounded-full transition-all duration-300" 
            style={{ width: `${(currentStep / 4) * 100}%` }}
          />
        </div>
      </div>

      {currentStep === 1 && renderStep1()}
      {currentStep === 2 && renderStep2()}
      {currentStep === 3 && renderStep3()}
      {currentStep === 4 && renderStep4()}
    </div>
  );
};