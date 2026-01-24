import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Wallet, Loader2, CheckCircle, Copy, Shield, Eye, EyeOff, Key, ArrowRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface WalletCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWalletCreated: (walletAddress: string) => void;
}

interface WalletCreationResult {
  success: boolean;
  wallet_address?: string;
  chain_id?: number;
  private_key_once?: string | null;
  already_existed?: boolean;
  error?: string;
}

type Step = 'confirm' | 'creating' | 'key_reveal' | 'success';

/**
 * Decodes a base64-encoded private key to 64-character lowercase hex.
 * Pure transformation - no side effects, no logging.
 */
function base64ToHex(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error(`Invalid private key length: ${bytes.length} bytes (expected 32)`);
  }
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function WalletCreationModal({ open, onOpenChange, onWalletCreated }: WalletCreationModalProps) {
  const [step, setStep] = useState<Step>('confirm');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);
  const [decodedHexKey, setDecodedHexKey] = useState<string | null>(null);
  const [hexDecodeError, setHexDecodeError] = useState<string | null>(null);
  const [hexKeyCopied, setHexKeyCopied] = useState(false);
  const { toast } = useToast();

  const handleConfirmCreate = async () => {
    setStep('creating');
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) {
        throw new Error('User not authenticated');
      }
      
      const { data, error: fnError } = await supabase.functions.invoke<WalletCreationResult>(
        'execution-wallet-create',
        { body: { user_id: user.id } }
      );

      if (fnError) {
        throw new Error(fnError.message || 'Failed to create wallet');
      }

      if (!data?.success || !data?.wallet_address) {
        throw new Error(data?.error || 'Wallet creation failed');
      }

      setWalletAddress(data.wallet_address);
      setChainId(data.chain_id || 8453);

      // Check if we have a private key (new wallet)
      if (data.private_key_once && !data.already_existed) {
        setPrivateKey(data.private_key_once);
        setStep('key_reveal');
      } else {
        // Existing wallet - no key reveal
        setStep('success');
        toast({
          title: "Wallet Retrieved",
          description: "Your existing wallet has been loaded.",
        });
        onWalletCreated(data.wallet_address);
      }
    } catch (err) {
      console.error('[WalletCreationModal] Error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStep('confirm');
      
      toast({
        title: "Wallet Creation Failed",
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: "destructive",
      });
    }
  };

  const copyPrivateKey = () => {
    if (privateKey) {
      navigator.clipboard.writeText(privateKey);
      setKeyCopied(true);
      toast({
        title: "Private Key Copied",
        description: "Store it somewhere safe - you won't see it again!",
      });
    }
  };

  const copyAddress = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      toast({
        title: "Copied",
        description: "Wallet address copied to clipboard",
      });
    }
  };

  /**
   * Decodes the base64 private key to hex on explicit user click only.
   * No logging, no persistence, no side effects.
   */
  const handleDecodeToHex = () => {
    if (!privateKey) return;
    
    setHexDecodeError(null);
    setDecodedHexKey(null);
    
    try {
      const hex = base64ToHex(privateKey);
      setDecodedHexKey(hex);
    } catch (err) {
      setHexDecodeError(err instanceof Error ? err.message : 'Decode failed');
    }
  };

  const copyHexKey = () => {
    if (decodedHexKey) {
      navigator.clipboard.writeText(decodedHexKey);
      setHexKeyCopied(true);
      toast({
        title: "Hex Key Copied",
        description: "64-character hex key copied - import into MetaMask/Rabby",
      });
    }
  };

  const handleKeyAcknowledged = () => {
    if (!keyCopied || !keyAcknowledged) {
      toast({
        title: "Please Confirm",
        description: "You must copy the key and acknowledge before continuing",
        variant: "destructive",
      });
      return;
    }

    // Clear the private key and decoded hex from memory
    setPrivateKey(null);
    setDecodedHexKey(null);
    setStep('success');
    
    toast({
      title: "Wallet Created",
      description: "Your trading wallet is ready. Fund it to enable live trading.",
    });

    if (walletAddress) {
      onWalletCreated(walletAddress);
    }
  };

  const getNetworkName = (id: number | null): string => {
    switch (id) {
      case 1: return 'Ethereum Mainnet';
      case 8453: return 'Base';
      case 137: return 'Polygon';
      case 42161: return 'Arbitrum';
      default: return 'Base';
    }
  };

  const handleClose = () => {
    // Don't allow closing during key reveal - user must acknowledge
    if (step === 'key_reveal') {
      toast({
        title: "Cannot Close",
        description: "You must save your private key before closing",
        variant: "destructive",
      });
      return;
    }
    
    if (step !== 'creating') {
      onOpenChange(false);
      // Reset state after close
      setTimeout(() => {
        setStep('confirm');
        setWalletAddress(null);
        setPrivateKey(null);
        setDecodedHexKey(null);
        setHexDecodeError(null);
        setHexKeyCopied(false);
        setError(null);
        setShowPrivateKey(false);
        setKeyCopied(false);
        setKeyAcknowledged(false);
      }, 200);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg bg-slate-900 border-slate-700">
        {/* Step 1: Confirm */}
        {step === 'confirm' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Wallet className="w-5 h-5 text-blue-400" />
                Create Trading Wallet
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                You're about to create a dedicated trading wallet.
              </DialogDescription>
            </DialogHeader>
            
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 my-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-200">
                  <p className="font-medium mb-2">Important:</p>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/80">
                    <li>This creates a dedicated wallet for automated trading</li>
                    <li>You will receive the private key <strong>once only</strong></li>
                    <li>Save the key immediately - it cannot be recovered</li>
                    <li>You can use this key in MetaMask or other wallets</li>
                  </ul>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="ghost"
                onClick={handleClose}
                className="text-slate-400 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmCreate}
                className="bg-blue-500 hover:bg-blue-600 text-white"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Create Wallet
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 2: Creating */}
        {step === 'creating' && (
          <div className="py-8 text-center">
            <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white mb-2">Creating Your Wallet</h3>
            <p className="text-slate-400 text-sm">
              Please wait while we generate your secure trading wallet...
            </p>
          </div>
        )}

        {/* Step 3: Key Reveal (ONE TIME ONLY) */}
        {step === 'key_reveal' && privateKey && walletAddress && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <Key className="w-5 h-5 text-amber-400" />
                Save Your Private Key
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                This is the <strong className="text-red-400">ONLY TIME</strong> you will see this key.
              </DialogDescription>
            </DialogHeader>

            {/* Critical Warning */}
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-4 my-4">
              <div className="flex gap-3">
                <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                <div className="text-sm text-red-200">
                  <p className="font-bold mb-2 text-red-300">⚠️ CRITICAL - READ CAREFULLY</p>
                  <ul className="space-y-1">
                    <li>• This key will <strong>NEVER</strong> be shown again</li>
                    <li>• If you lose it, you lose access to funds outside this app</li>
                    <li>• Copy it NOW and store it securely</li>
                    <li>• The app can still trade without you needing the key</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Wallet Address */}
            <div className="bg-slate-800 rounded-lg p-4 mb-3">
              <div className="text-xs text-slate-400 mb-1">Wallet Address</div>
              <div className="flex items-center gap-2">
                <code className="text-green-400 text-sm font-mono break-all flex-1">
                  {walletAddress}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyAddress}
                  className="text-slate-400 hover:text-white flex-shrink-0"
                >
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Private Key */}
            <div className="bg-slate-800 rounded-lg p-4 mb-3 border-2 border-amber-500/50">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-amber-400 font-medium">🔐 Private Key (ONE-TIME REVEAL)</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                  className="text-slate-400 hover:text-white h-6 px-2"
                >
                  {showPrivateKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <code className={`text-amber-300 text-xs font-mono break-all flex-1 bg-slate-900 p-3 rounded ${!showPrivateKey ? 'blur-sm select-none' : ''}`}>
                  {showPrivateKey ? privateKey : '••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copyPrivateKey}
                  className={`flex-shrink-0 ${keyCopied ? 'text-green-400' : 'text-amber-400 hover:text-amber-300'}`}
                >
                  {keyCopied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                </Button>
              </div>
              {keyCopied && (
                <div className="text-xs text-green-400 mt-2 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Key copied to clipboard
                </div>
              )}
            </div>

            {/* Decode to Hex Section */}
            <div className="bg-slate-800/50 rounded-lg p-4 mb-3 border border-slate-600">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-300 font-medium">
                  Import to MetaMask / Rabby
                </div>
              </div>
              
              {!decodedHexKey && !hexDecodeError && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDecodeToHex}
                  className="w-full border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700"
                >
                  <ArrowRight className="w-4 h-4 mr-2" />
                  Decode to Private Key (hex)
                </Button>
              )}

              {hexDecodeError && (
                <div className="text-xs text-red-400 bg-red-500/10 p-3 rounded border border-red-500/30">
                  {hexDecodeError}
                </div>
              )}

              {decodedHexKey && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    Ethereum Private Key (64-hex)
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={decodedHexKey}
                      className="flex-1 bg-slate-900 text-green-400 text-xs font-mono p-3 rounded border border-slate-600 outline-none"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={copyHexKey}
                      className={`flex-shrink-0 ${hexKeyCopied ? 'text-green-400' : 'text-slate-400 hover:text-white'}`}
                    >
                      {hexKeyCopied ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </Button>
                  </div>
                  {hexKeyCopied && (
                    <div className="text-xs text-green-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Hex key copied - paste into MetaMask/Rabby
                    </div>
                  )}
                  {/* Security Warning */}
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-xs text-red-300">
                    ⚠️ Never share this key. Anyone with it can fully control your funds.
                  </div>
                </div>
              )}
            </div>

            {/* Network Info */}
            <div className="bg-slate-800/50 rounded-lg p-3 mb-4">
              <div className="text-xs text-slate-400 mb-1">Network</div>
              <div className="text-white font-medium">{getNetworkName(chainId)}</div>
            </div>

            {/* Acknowledgment Checkbox */}
            <div className={`border rounded-lg p-4 ${keyAcknowledged && keyCopied ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5'}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="acknowledge-key"
                  checked={keyAcknowledged}
                  onCheckedChange={(checked) => setKeyAcknowledged(checked === true)}
                  className="mt-0.5"
                  disabled={!keyCopied}
                />
                <label 
                  htmlFor="acknowledge-key" 
                  className={`text-sm font-medium cursor-pointer select-none ${keyCopied ? 'text-white' : 'text-slate-500'}`}
                >
                  I have copied and securely stored my private key. I understand it will never be shown again.
                </label>
              </div>
              {!keyCopied && (
                <p className="text-xs text-amber-400 mt-2 ml-6">
                  You must copy the key first
                </p>
              )}
            </div>

            <DialogFooter className="mt-4">
              <Button
                onClick={handleKeyAcknowledged}
                disabled={!keyCopied || !keyAcknowledged}
                className="w-full bg-green-500 hover:bg-green-600 text-white disabled:opacity-50"
              >
                <Shield className="w-4 h-4 mr-2" />
                I've Saved My Key - Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {/* Step 4: Success */}
        {step === 'success' && walletAddress && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-white">
                <CheckCircle className="w-5 h-5 text-green-400" />
                Wallet Created Successfully
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Your trading wallet is ready. Fund it to enable live trading.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Network</div>
                <div className="text-white font-medium">{getNetworkName(chainId)}</div>
              </div>
              
              <div className="bg-slate-800 rounded-lg p-4">
                <div className="text-xs text-slate-400 mb-1">Wallet Address</div>
                <div className="flex items-center gap-2">
                  <code className="text-green-400 text-sm font-mono break-all flex-1">
                    {walletAddress}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyAddress}
                    className="text-slate-400 hover:text-white flex-shrink-0"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-blue-200 text-sm">
                Send ETH or USDC on {getNetworkName(chainId)} to this address to fund your trading wallet.
              </div>

              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-green-200 text-sm flex gap-2">
                <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Your private key has been encrypted and stored securely. You can also use the key you saved to access this wallet externally.</span>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={handleClose}
                className="w-full bg-green-500 hover:bg-green-600 text-white"
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
