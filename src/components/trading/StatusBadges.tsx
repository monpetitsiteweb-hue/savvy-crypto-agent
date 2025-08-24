import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Lock } from 'lucide-react';

interface Trade {
  is_corrupted?: boolean;
  integrity_reason?: string;
}

interface StatusBadgesProps {
  trade: Trade;
  coordinatorReason?: string;
}

export const StatusBadges: React.FC<StatusBadgesProps> = ({ trade, coordinatorReason }) => {
  const isCorrupted = trade.is_corrupted;
  const isLocked = coordinatorReason === 'blocked_by_lock';
  
  if (!isCorrupted && !isLocked) return null;

  return (
    <TooltipProvider>
      <div className="flex gap-1 mb-1">
        {isCorrupted && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" />
                Corrupted
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">
                <strong>Data Integrity Issue:</strong><br />
                {trade.integrity_reason || 'Unknown corruption detected'}
                <br /><br />
                This position has corrupted data and needs manual review.
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {isLocked && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-xs">
                <Lock className="w-3 h-3 mr-1" />
                Locked
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">
                <strong>Trade Processing Lock:</strong><br />
                Concurrent trading activity detected for this symbol.
                <br />
                This prevents race conditions and ensures data integrity.
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
};