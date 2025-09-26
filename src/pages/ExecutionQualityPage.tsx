import { useAuth } from '@/hooks/useAuth';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { Header } from '@/components/Header';
import { ExecutionBreakersCard } from '@/components/execution/ExecutionBreakersCard';
import { ExecutionQualityMetrics24h } from '@/components/execution/ExecutionQualityMetrics24h';

export function ExecutionQualityPage() {
  const { user } = useAuth();
  const { activeStrategy } = useActiveStrategy();

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
            <p className="text-muted-foreground">Please log in to view execution quality metrics.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Execution Quality</h1>
          <p className="text-muted-foreground">
            Monitor execution performance and circuit breaker status
            {activeStrategy && ` for strategy: ${activeStrategy.strategy_name}`}
          </p>
        </div>

        <div className="space-y-6">
          <ExecutionQualityMetrics24h 
            userId={user.id} 
            strategyId={activeStrategy?.id}
          />
          
          <ExecutionBreakersCard 
            userId={user.id} 
            strategyId={activeStrategy?.id}
          />
        </div>
      </div>
    </div>
  );
}

export default ExecutionQualityPage;