import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Lock, Flame } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  StrategyDimension, 
  DIMENSION_INFO, 
  getFieldDimension, 
  isFieldLocked,
  PRESET_RISK_FIELDS
} from '@/utils/strategyPresets';

interface DimensionBadgeProps {
  dimension: StrategyDimension;
  size?: 'sm' | 'md';
}

/**
 * Visual badge indicating which dimension a field belongs to
 * NOTE: Only used for informational display, NOT for Risk Profile fields
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

interface RiskProfileBadgeProps {
  fieldName: string;
  riskProfile: string;
}

/**
 * 🔥 Risk Profile badge - ONLY for the 12 Risk Profile fields
 * Shows the badge AND lock indicator when field is preset-controlled
 */
export const RiskProfileBadge: React.FC<RiskProfileBadgeProps> = ({ 
  fieldName, 
  riskProfile 
}) => {
  const isRiskField = PRESET_RISK_FIELDS.includes(fieldName as any);
  const locked = isFieldLocked(riskProfile, fieldName);
  
  if (!isRiskField) return null;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="font-medium">🔥 Risk Profile Field</p>
        {locked ? (
          <p className="text-xs text-muted-foreground">
            Controlled by {riskProfile.toUpperCase()} preset. Switch to Custom to edit.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            This field affects trading risk. Currently editable in Custom mode.
          </p>
        )}
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
}

/**
 * Combined label component for the 12 Risk Profile fields
 * Shows: Label + 🔥 badge + lock icon (if locked)
 * NOTE: Does NOT show dimension badges - only the Risk Profile indicator
 */
export const RiskFieldLabel: React.FC<RiskFieldLabelProps> = ({
  children,
  fieldName,
  riskProfile
}) => {
  return (
    <div className="flex items-center gap-2">
      {children}
      <RiskProfileBadge fieldName={fieldName} riskProfile={riskProfile} />
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
 * Section header with optional dimension badge and micro-explanation
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