import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CorruptionWarningProps {
  isCorrupted?: boolean;
  integrityReason?: string;
  className?: string;
}

export const CorruptionWarning = ({ 
  isCorrupted, 
  integrityReason,
  className = "" 
}: CorruptionWarningProps) => {
  if (!isCorrupted) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className={`ml-2 ${className}`}>
            <AlertTriangle className="w-3 h-3 mr-1" />
            Corrupted
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">
            <strong>Data Integrity Issue:</strong><br />
            {integrityReason || 'Unknown corruption detected'}
            <br /><br />
            This position has corrupted data and needs manual review.
            Contact support for assistance.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};