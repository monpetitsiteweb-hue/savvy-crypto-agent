import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Upload, 
  FileJson, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  Lock,
  Flame
} from 'lucide-react';
import {
  deserializeStrategy,
  readJsonFile,
  exportedStrategyToFormData,
  getRiskFieldsSummary,
  type ExportedStrategy,
  type ValidationResult,
} from '@/utils/strategySerializer';
import { RISK_PROFILE_DESCRIPTIONS } from '@/utils/strategyPresets';

interface StrategyImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (formData: Record<string, any>) => void;
}

type ImportStep = 'upload' | 'preview' | 'error';

export function StrategyImportModal({ 
  open, 
  onOpenChange, 
  onImport 
}: StrategyImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<ImportStep>('upload');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [strategyName, setStrategyName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!file.name.endsWith('.json')) {
      setValidation({
        valid: false,
        errors: ['Only .json files are accepted'],
        warnings: [],
      });
      setStep('error');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const json = await readJsonFile(file);
      const result = deserializeStrategy(json);
      
      setValidation(result);
      
      if (result.valid && result.data) {
        setStrategyName(result.data.metadata.name);
        setStep('preview');
      } else {
        setStep('error');
      }
    } catch (error) {
      setValidation({
        valid: false,
        errors: [(error as Error).message || 'Failed to parse file'],
        warnings: [],
      });
      setStep('error');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleImportConfirm = () => {
    if (!validation?.data) return;
    
    const formData = exportedStrategyToFormData(validation.data);
    formData.strategyName = strategyName; // Use potentially edited name
    
    onImport(formData);
    handleClose();
  };
  
  const handleClose = () => {
    setStep('upload');
    setValidation(null);
    setStrategyName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onOpenChange(false);
  };
  
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.json')) {
      // Create a synthetic event for handleFileSelect
      const syntheticEvent = {
        target: { files: [file] }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      await handleFileSelect(syntheticEvent);
    }
  };
  
  const renderUploadStep = () => (
    <div 
      className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileSelect}
        className="hidden"
      />
      <FileJson className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h3 className="text-lg font-medium mb-2">Drop strategy file here</h3>
      <p className="text-sm text-muted-foreground mb-4">
        or click to browse
      </p>
      <Button variant="outline" disabled={isLoading}>
        <Upload className="h-4 w-4 mr-2" />
        {isLoading ? 'Loading...' : 'Select .json file'}
      </Button>
    </div>
  );
  
  const renderPreviewStep = () => {
    if (!validation?.data) return null;
    
    const { metadata, configuration } = validation.data;
    const riskProfile = metadata.riskProfile;
    const riskInfo = RISK_PROFILE_DESCRIPTIONS[riskProfile];
    const riskFields = getRiskFieldsSummary(configuration);
    const isLocked = riskProfile !== 'custom';
    
    return (
      <div className="space-y-4">
        {/* Strategy Name (editable) */}
        <div className="space-y-2">
          <Label htmlFor="import-name">Strategy Name</Label>
          <Input
            id="import-name"
            value={strategyName}
            onChange={(e) => setStrategyName(e.target.value)}
            placeholder="Enter strategy name"
          />
        </div>
        
        {/* Risk Profile */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Risk Profile:</span>
          <Badge variant={riskInfo.color as any} className="capitalize">
            {riskProfile}
          </Badge>
          {isLocked && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              Risk fields will be locked
            </span>
          )}
        </div>
        
        {/* Warnings */}
        {validation.warnings.length > 0 && (
          <Alert variant="default" className="bg-yellow-500/10 border-yellow-500/50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Notice</AlertTitle>
            <AlertDescription>
              <ul className="list-disc list-inside text-sm">
                {validation.warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        
        {/* Risk Fields Summary */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-medium">Risk Profile Fields (12)</span>
          </div>
          <ScrollArea className="h-[200px] border rounded-md p-3">
            <div className="grid grid-cols-2 gap-2">
              {riskFields.map(({ field, label, value }) => (
                <div 
                  key={field}
                  className="flex justify-between items-center p-2 bg-muted/50 rounded text-sm"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{value}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        
        {/* Selected Coins */}
        {configuration.selectedCoins && configuration.selectedCoins.length > 0 && (
          <div className="space-y-2">
            <span className="text-sm font-medium">Selected Coins</span>
            <div className="flex flex-wrap gap-1">
              {configuration.selectedCoins.slice(0, 10).map((coin: string) => (
                <Badge key={coin} variant="outline" className="text-xs">
                  {coin}
                </Badge>
              ))}
              {configuration.selectedCoins.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{configuration.selectedCoins.length - 10} more
                </Badge>
              )}
            </div>
          </div>
        )}
        
        {/* Metadata */}
        <div className="text-xs text-muted-foreground space-y-1">
          {metadata.notes && (
            <p>Notes: {metadata.notes}</p>
          )}
          <p>Originally created: {new Date(metadata.createdAt).toLocaleDateString()}</p>
          <p>Exported: {new Date(metadata.exportedAt).toLocaleDateString()}</p>
        </div>
      </div>
    );
  };
  
  const renderErrorStep = () => (
    <div className="space-y-4">
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Import Failed</AlertTitle>
        <AlertDescription>
          <ul className="list-disc list-inside text-sm mt-2">
            {validation?.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
      <Button 
        variant="outline" 
        onClick={() => {
          setStep('upload');
          setValidation(null);
        }}
        className="w-full"
      >
        Try Again
      </Button>
    </div>
  );
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Import Strategy
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload a previously exported strategy configuration.'}
            {step === 'preview' && 'Review the strategy before importing.'}
            {step === 'error' && 'There was an issue with the import file.'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="py-4">
          {step === 'upload' && renderUploadStep()}
          {step === 'preview' && renderPreviewStep()}
          {step === 'error' && renderErrorStep()}
        </div>
        
        {step === 'preview' && (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleImportConfirm}
              disabled={!strategyName.trim()}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Create Strategy
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
