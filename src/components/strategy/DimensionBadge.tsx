import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Lock } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  StrategyDimension, 
  DIMENSION_INFO, 
  getFieldDimension, 
  isFieldLocked 
} from '@/utils/strategyPresets';

interface DimensionBadgeProps {
  dimension: StrategyDimension;
  size?: 'sm' | 'md';
}

/**
 * Visual badge indicating which dimension a field belongs to
 */
export const DimensionBadge: React.FC<DimensionBadgeProps> = ({ dimension, size = 'sm' }) => {
  const info = DIMENSION_INFO[dimension];
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center gap-1 ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
          <span>{info.icon}</span>
          {size === 'md' && <span className={`font-medium ${info.color}`}>{info.label}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-medium">{info.label}</p>
        <p className="text-xs text-muted-foreground">{info.description}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface FieldLockIndicatorProps {
  fieldName: string;
  riskProfile: string;
  showLabel?: boolean;
}

/**
 * Lock icon indicator for preset-controlled fields
 */
export const FieldLockIndicator: React.FC<FieldLockIndicatorProps> = ({ 
  fieldName, 
  riskProfile,
  showLabel = false 
}) => {
  const locked = isFieldLocked(riskProfile, fieldName);
  
  if (!locked) return null;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Lock className="h-3 w-3" />
          {showLabel && <span className="text-xs">Preset</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-medium">Controlled by Risk Profile</p>
        <p className="text-xs text-muted-foreground">Switch to Custom to edit this field.</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface RiskFieldLabelProps {
  children: React.ReactNode;
  fieldName: string;
  riskProfile: string;
  showDimension?: boolean;
}

/**
 * Combined label component for risk-impacting fields
 * Shows the label, dimension badge, and lock indicator
 */
export const RiskFieldLabel: React.FC<RiskFieldLabelProps> = ({
  children,
  fieldName,
  riskProfile,
  showDimension = true
}) => {
  const dimension = getFieldDimension(fieldName);
  const locked = isFieldLocked(riskProfile, fieldName);
  
  return (
    <div className="flex items-center gap-2">
      {children}
      {showDimension && dimension && <DimensionBadge dimension={dimension} size="sm" />}
      {locked && <FieldLockIndicator fieldName={fieldName} riskProfile={riskProfile} />}
    </div>
  );
};

interface SectionHeaderProps {
  title: string;
  description: string;
  dimension?: StrategyDimension;
  isActive?: boolean;
}

/**
 * Section header with dimension badge and micro-explanation
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  description,
  dimension,
  isActive = true
}) => {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        {dimension && <DimensionBadge dimension={dimension} size="md" />}
        {!isActive && (
          <Badge variant="outline" className="text-xs bg-muted">
            Informational
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
};

export default DimensionBadge;
