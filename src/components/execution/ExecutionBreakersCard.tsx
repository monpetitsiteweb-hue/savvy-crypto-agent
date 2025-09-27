import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle } from 'lucide-react';
import { getBreakers, type BreakerRow } from '@/lib/db/execution';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

interface ExecutionBreakersCardProps {
  userId: string;
  strategyId?: string;
}

export function ExecutionBreakersCard({ userId, strategyId }: ExecutionBreakersCardProps) {
  const [breakers, setBreakers] = useState<BreakerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const { toast } = useToast();

  const loadBreakers = async () => {
    try {
      setLoading(true);
      const data = await getBreakers(userId, strategyId);
      setBreakers(data);
    } catch (error) {
      console.error('Failed to load breakers:', error);
      toast({
        title: "Error",
        description: "Failed to load circuit breakers",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (breaker: BreakerRow) => {
    const resetKey = `${breaker.user_id}-${breaker.strategy_id}-${breaker.symbol}-${breaker.breaker_type}`;
    setResetting(resetKey);

    try {
      const { data, error } = await supabase.functions.invoke('breaker-ops', {
        body: {
          action: 'reset',
          user_id: breaker.user_id,
          strategy_id: breaker.strategy_id,
          symbol: breaker.symbol,
          breaker: breaker.breaker_type,
        },
      });

      if (error || !data?.ok) {
        throw new Error(error?.message || data?.error || 'Failed to reset breaker');
      }

      toast({
        title: "Success",
        description: "Circuit breaker reset successfully",
      });

      await loadBreakers();
    } catch (error) {
      console.error('Failed to reset breaker:', error);
      toast({
        title: "Error",
        description: "Failed to reset circuit breaker",
        variant: "destructive",
      });
    } finally {
      setResetting(null);
    }
  };

  useEffect(() => {
    loadBreakers();
  }, [userId, strategyId]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Circuit Breakers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Circuit Breakers
        </CardTitle>
      </CardHeader>
      <CardContent>
        {breakers.length === 0 ? (
          <p className="text-muted-foreground text-center py-4">No circuit breakers configured</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Breaker</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Reason</TableHead>
                  <TableHead>Tripped At</TableHead>
                  <TableHead>Cleared At</TableHead>
                  <TableHead>Trip Count</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakers.map((breaker) => (
                  <TableRow key={breaker.id}>
                    <TableCell className="font-medium">{breaker.symbol}</TableCell>
                     <TableCell>{breaker.breaker_type}</TableCell>
                     <TableCell>
                       <Badge variant={!breaker.is_active ? "destructive" : "secondary"}>
                         {!breaker.is_active ? "Tripped" : "Normal"}
                       </Badge>
                     </TableCell>
                     <TableCell className="max-w-xs truncate">
                       {breaker.trip_reason || '-'}
                     </TableCell>
                     <TableCell>
                       {breaker.last_trip_at 
                         ? format(new Date(breaker.last_trip_at), 'MMM dd, HH:mm')
                         : '-'
                       }
                     </TableCell>
                     <TableCell>
                       -
                     </TableCell>
                    <TableCell>{breaker.trip_count}</TableCell>
                    <TableCell>
                      {format(new Date(breaker.updated_at), 'MMM dd, HH:mm')}
                    </TableCell>
                    <TableCell>
                     {!breaker.is_active && (
                       <Button
                         variant="outline"
                         size="sm"
                         onClick={() => handleReset(breaker)}
                         disabled={resetting === `${breaker.user_id}-${breaker.strategy_id}-${breaker.symbol}-${breaker.breaker_type}`}
                       >
                         {resetting === `${breaker.user_id}-${breaker.strategy_id}-${breaker.symbol}-${breaker.breaker_type}` ? (
                           <Loader2 className="h-4 w-4 animate-spin" />
                         ) : (
                           'Reset'
                         )}
                       </Button>
                     )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}