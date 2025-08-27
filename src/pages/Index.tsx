
import { useState, useEffect, useRef, memo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { AuthPage } from '@/components/auth/AuthPage';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ConversationPanel } from '@/components/ConversationPanel';
import { DebugPanel } from '@/components/DebugPanel';
import { MergedPortfolioDisplay } from '@/components/MergedPortfolioDisplay';
import { TradingHistory } from '@/components/TradingHistory';
import { StrategyConfig } from '@/components/StrategyConfig';
import { TestStrategyConfig } from '@/components/TestStrategyConfig';
import { PerformanceOverview } from '@/components/PerformanceOverview';
import { LiveIndicatorKPI } from '@/components/strategy/LiveIndicatorKPI';
import { AdminPage } from '@/components/admin/AdminPage';
import { MarketDashboard } from '@/components/market/MarketDashboard';
import { TradingViewMarketDashboard } from '@/components/market/TradingViewMarketDashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useUserRole } from '@/hooks/useUserRole';
import { ContextFreezeBarrier } from '@/components/ContextFreezeBarrier';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useTestMode } from '@/hooks/useTestMode';
import { useActiveStrategy } from '@/hooks/useActiveStrategy';
import { useIntelligentTradingEngine } from '@/hooks/useIntelligentTradingEngine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';

// Step 3 & 5: Parent debug gate and helpers
const RUNTIME_DEBUG =
  (() => {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get('debug') === 'history' || u.hash.includes('debug=history') || sessionStorage.getItem('DEBUG_HISTORY_BLINK') === 'true';
    } catch { return false; }
  })();

const DEBUG_HISTORY_BLINK =
  (import.meta.env.DEV && (import.meta.env.VITE_DEBUG_HISTORY_BLINK === 'true')) || RUNTIME_DEBUG;

const fp = (v: any): string => {
  if (v == null) return 'null';
  if (Array.isArray(v)) return `arr(len=${v.length})`;
  if (typeof v === 'object') {
    const keys = Object.keys(v).slice(0, 4).join(',');
    return `obj(${keys})`;
  }
  if (typeof v === 'function') return 'fn';
  return String(v);
};

// Step 5: Runtime key pin (pinHistoryKey=1)
const PIN_HISTORY_KEY = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('pinHistoryKey') === '1';
  } catch { return false; }
})();

// Step 6: Debug toggles (traceTimers, traceNetwork, traceContexts, freezeIndexParent)
const TRACE_TIMERS = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('traceTimers') === '1';
  } catch { return false; }
})();

const TRACE_NETWORK = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('traceNetwork') === '1';
  } catch { return false; }
})();

const TRACE_CONTEXTS = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('traceContexts') === '1';
  } catch { return false; }
})();

const FREEZE_INDEX_PARENT = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('freezeIndexParent') === '1';
  } catch { return false; }
})();

// Step 8: Additional hard-freeze switches
const FORCE_FREEZE_INDEX_PARENT = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('forceFreezeIndexParent') === '1';
  } catch { return false; }
})();

const TRACE_PARENT_STATE = (() => {
  try {
    const u = new URL(window.location.href);
    return RUNTIME_DEBUG && u.searchParams.get('traceParentState') === '1';
  } catch { return false; }
})();

// Step 6: Timer monkey-patching
if (TRACE_TIMERS && typeof window !== 'undefined') {
  const timerStats = new Map<any, any>();
  const originalSetInterval = window.setInterval;
  const originalSetTimeout = window.setTimeout;
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  
  const logTimerStats = () => {
    timerStats.forEach((stats, id) => {
      const firesPerSec = stats.callCount;
      if (firesPerSec >= 2) {
        if (stats.type === 'setInterval') {
          console.info(`[HistoryBlink] timer: setInterval interval=${stats.interval}ms firesPerSec=${firesPerSec} createdAt=${stats.createdAt}`);
        } else if (stats.type === 'raf') {
          console.info(`[HistoryBlink] raf: firesPerSec=${firesPerSec}`);
        }
      }
      stats.callCount = 0; // Reset for next second
    });
    setTimeout(logTimerStats, 1000);
  };
  setTimeout(logTimerStats, 1000);

  (window as any).setInterval = function(callback: any, ms: any, ...args: any[]) {
    const id = originalSetInterval.call(this, (...callbackArgs: any[]) => {
      const stats = timerStats.get(id);
      if (stats) stats.callCount++;
      return callback(...callbackArgs);
    }, ms, ...args);
    
    timerStats.set(id, {
      type: 'setInterval',
      interval: ms,
      createdAt: performance.now(),
      callCount: 0
    });
    return id;
  };

  (window as any).requestAnimationFrame = function(callback: any) {
    const id = originalRequestAnimationFrame.call(this, (timestamp: number) => {
      const stats = timerStats.get(id) || { type: 'raf', callCount: 0, createdAt: performance.now() };
      stats.callCount++;
      timerStats.set(id, stats);
      return callback(timestamp);
    });
    return id;
  };
}

// Step 6: Network monkey-patching
if (TRACE_NETWORK && typeof window !== 'undefined') {
  const networkStats = new Map<string, any>();
  const originalFetch = window.fetch;
  
  const logNetworkStats = () => {
    networkStats.forEach((stats, endpoint) => {
      if (stats.hitsPerSec >= 2) {
        console.info(`[HistoryBlink] net: ${stats.method} ${endpoint} hitsPerSec=${stats.hitsPerSec}`);
      }
      stats.hitsPerSec = 0; // Reset for next second
    });
    setTimeout(logNetworkStats, 1000);
  };
  setTimeout(logNetworkStats, 1000);

  (window as any).fetch = function(input: any, init?: any) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const endpoint = url.split('?')[0]; // Remove query params for grouping
    
    const stats = networkStats.get(endpoint) || { method, hitsPerSec: 0 };
    stats.hitsPerSec++;
    networkStats.set(endpoint, stats);
    
    return originalFetch.call(this, input, init);
  };
}
const stateCallLog = new Map<string, number>();
const traceSet = (stateName: string, reasonTag: string) => {
  if (TRACE_PARENT_STATE) {
    const now = performance.now();
    const key = `${stateName}_${reasonTag}`;
    if (!stateCallLog.has(key) || now - stateCallLog.get(key)! > 1000) {
      console.info(`[HistoryBlink] parent-set: name=${stateName} reason=${reasonTag} ts=${Math.floor(now)}`);
      stateCallLog.set(key, now);
    }
  }
};

function IndexComponent() {
  const { user, loading } = useAuth();
  const marketData = useMarketData();
  const testModeContext = useTestMode();
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const setActiveTabTraced = (value: string) => {
    traceSet('activeTab', 'userClick');
    setActiveTab(value);
  };
  
  const [isStrategyFullWidth, setIsStrategyFullWidth] = useState(false);
  const setIsStrategyFullWidthTraced = (value: boolean) => {
    traceSet('isStrategyFullWidth', 'layoutChange');
    setIsStrategyFullWidth(value);
  };
  
  // Step 3: Parent mount counter + rate limiting
  const parentMountCountRef = useRef(0);
  const parentLastLogRef = useRef(0);
  
  // Step 5: Provider fingerprint tracking
  const providerVersionRef = useRef(0);
  
  // Step 6: Context fingerprint tracking
  const contextFingerprintRef = useRef({
    priceVer: 0,
    authVer: 0,
    flagsVer: 0,
    routeKey: ''
  });
  const contextLastLogRef = useRef(0);
  
  // Increment mount counter
  parentMountCountRef.current += 1;
  
  const { testMode, setTestMode } = testModeContext;
  const { role, loading: roleLoading } = useUserRole();
  const { hasActiveStrategy } = useActiveStrategy();
  
  // Step 9: Context change logging with version tracking
  const contextChangeLog = useRef(new Map<string, number>());
  useEffect(() => {
    if (RUNTIME_DEBUG) {
      const now = performance.now();
      const lastLog = contextChangeLog.current.get('contextChange') || 0;
      
      if (now - lastLog > 1000) { // Rate limit to once per second
        const priceVer = (marketData as any)?.version || 0;
        const authVer = user ? 1 : 0; // Simple version based on user presence
        const testModeVer = testMode ? 1 : 0;
        const flagsVer = testModeVer; // Use testMode as flags for now
        
        console.info(`[HistoryBlink] ctxChange: price.ver=${priceVer} indicators.ver=0 auth.ver=${authVer} flags.ver=${flagsVer}`);
        contextChangeLog.current.set('contextChange', now);
      }
    }
  }, [marketData, user, testMode]);
  
  // Step 3, 5 & 6: Log parent mount + props + provider fingerprints + context changes (rate-limited to 1/sec)
  useEffect(() => {
    if (DEBUG_HISTORY_BLINK) {
      const now = performance.now();
      if (now - parentLastLogRef.current > 1000) {
        console.info(`[HistoryBlink] <IndexParent> mount ${parentMountCountRef.current} | key=undefined`);
        console.info(`[HistoryBlink] <IndexParent> props: { activeTab=${fp(activeTab)}, user=${fp(user)}, loading=${fp(loading)}, hasActiveStrategy=${fp(hasActiveStrategy)} }`);
        
        // Step 5: Provider fingerprints
        providerVersionRef.current += 1;
        console.info(`[HistoryBlink] parent providers: { auth=ver:${providerVersionRef.current}, theme:default, testMode=${testMode}, user=${user?.id || 'null'} }`);
        
        // Step 5: Parent key scanner  
        console.info('[HistoryBlink] <TabWrapper> key=undefined');
        console.info('[HistoryBlink] <TabContent> key=undefined');
        
        // Step 5: pinHistoryKey status
        if (PIN_HISTORY_KEY) {
          console.info('[HistoryBlink] pinHistoryKey active: top wrapper key forced stable');
        }
        
        parentLastLogRef.current = now;
      }
      
      // Step 6: Context change tracking
      if (TRACE_CONTEXTS && now - contextLastLogRef.current > 1000) {
        const currentFingerprint = {
          priceVer: Math.floor(Date.now() / 1000), // Simple price tick simulation
          authVer: user ? 1 : 0,
          flagsVer: testMode ? 1 : 0,
          routeKey: window.location.pathname + window.location.search
        };
        
        const prev = contextFingerprintRef.current;
        if (JSON.stringify(currentFingerprint) !== JSON.stringify(prev)) {
          console.info(`[HistoryBlink] ctx: price.ver=${currentFingerprint.priceVer}, auth.ver=${currentFingerprint.authVer}, flags.ver=${currentFingerprint.flagsVer}, route.key=${currentFingerprint.routeKey.slice(-6)}`);
          contextFingerprintRef.current = currentFingerprint;
        }
        contextLastLogRef.current = now;
      }
    }
  });
  
  // ✅ START THE TRADING ENGINE! This was missing - that's why no trades happened
  const { checkStrategiesAndExecute } = useIntelligentTradingEngine();
  
  
  console.log('🔵 INDEX: AUTH STATE CHECK', { 
    user: user ? { id: user.id, email: user.email } : null, 
    userExists: !!user,
    loading, 
    testMode,
    roleLoading,
    role,
    activeTab
  });
  
  console.log('🔵 INDEX: PORTFOLIO RENDERING CONDITIONS', {
    activeTab,
    isDashboard: activeTab === 'dashboard',
    hasActiveStrategy,
    willRenderPortfolio: activeTab === 'dashboard'
  });

  if (loading || roleLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      <Header />
      
      <div className="container mx-auto px-4 py-6 flex-1">
        {/* Debug Panel */}
        <div className="mb-6">
          <DebugPanel />
        </div>
        
        <div className={`${isStrategyFullWidth && activeTab === 'strategy' ? 'w-full' : 'grid grid-cols-1 lg:grid-cols-3 gap-6'} min-h-[calc(100vh-200px)]`}>
          {/* Left Panel - Conversation */}
          {!(isStrategyFullWidth && activeTab === 'strategy') && (
            <div className="lg:col-span-1">
              <ConversationPanel />
            </div>
          )}
          
          {/* Right Panel - Dashboard/History/Config */}
          <div className={isStrategyFullWidth && activeTab === 'strategy' ? 'w-full' : 'lg:col-span-2'}>
            <div className="bg-slate-800/80 backdrop-blur-sm rounded-xl border border-slate-700 h-full flex flex-col">
              {/* Tab Navigation - Mobile Responsive */}
              <div className="border-b border-slate-700 flex-shrink-0">
                {/* Mobile: Full width tabs */}
                <div className="md:hidden grid grid-cols-5 w-full">
                  {[
                    { id: 'dashboard', label: 'Dashboard' },
                    { id: 'market', label: 'Market' },
                    { id: 'history', label: 'History' },
                    { id: 'strategy', label: 'Strategy' },
                    { id: 'performance', label: 'Performance' }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setActiveTabTraced(tab.id);
                      }}
                      className={`px-2 py-4 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Desktop: Normal tabs + toggle */}
                <div className="hidden md:flex justify-between items-center">
                  <div className="flex">
                    {[
                      { id: 'dashboard', label: 'Dashboard' },
                      { id: 'market', label: 'Market' },
                      { id: 'history', label: 'History' },
                      { id: 'strategy', label: 'Strategy' },
                      { id: 'performance', label: 'Performance' }
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          setActiveTabTraced(tab.id);
                        }}
                        className={`px-6 py-4 text-sm font-medium transition-colors whitespace-nowrap ${
                          activeTab === tab.id
                            ? 'text-green-400 border-b-2 border-green-400 bg-slate-700/50'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  
                  {/* Test Mode Toggle - Desktop */}
                  <div className="flex items-center gap-3 px-6 py-4">
                    <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                      {testMode ? 'Test' : 'Live'}
                    </span>
                    <Switch
                      checked={testMode}
                      onCheckedChange={setTestMode}
                      className="data-[state=checked]:bg-orange-500"
                    />
                  </div>
                </div>

                {/* Test Mode Toggle - Mobile */}
                <div className="md:hidden p-4 border-t border-slate-600">
                  <div className="bg-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                          Trading Mode
                        </span>
                        <p className="text-xs text-slate-500 mt-1">
                          {testMode ? 'Using simulated money' : 'Using real money'}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-sm font-medium ${testMode ? 'text-orange-400' : 'text-slate-400'}`}>
                          {testMode ? 'Test' : 'Live'}
                        </span>
                        <Switch
                          checked={testMode}
                          onCheckedChange={setTestMode}
                          className="data-[state=checked]:bg-orange-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Tab Content */}
              <div className="p-6 flex-1 overflow-y-auto min-h-0">
                {activeTab === 'dashboard' && (
                  <div className="space-y-6">
                    <ErrorBoundary>
                      <MergedPortfolioDisplay 
                        hasActiveStrategy={hasActiveStrategy}
                        onCreateStrategy={() => setActiveTab('strategy')}
                      />
                    </ErrorBoundary>
                    <ErrorBoundary>
                      <LiveIndicatorKPI />
                    </ErrorBoundary>
                  </div>
                )}
                {activeTab === 'market' && (
                  <ErrorBoundary>
                    <TradingViewMarketDashboard />
                  </ErrorBoundary>
                )}
                {activeTab === 'history' && (
                  <ErrorBoundary key={PIN_HISTORY_KEY ? 'history-stable' : undefined}>
                     <ContextFreezeBarrier>
                       <TradingHistory />
                     </ContextFreezeBarrier>
                  </ErrorBoundary>
                )}
                {activeTab === 'strategy' && (
                  <ErrorBoundary>
                    <StrategyConfig onLayoutChange={setIsStrategyFullWidthTraced} />
                  </ErrorBoundary>
                )}
                 {activeTab === 'performance' && (
                   <ErrorBoundary>
                     <PerformanceOverview 
                       hasActiveStrategy={hasActiveStrategy}
                        onCreateStrategy={() => setActiveTabTraced('strategy')}
                     />
                   </ErrorBoundary>
                 )}
                 
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}

// Step 6: freezeIndexParent memo wrapper
const MemoizedIndexComponent = memo(IndexComponent, (prevProps, nextProps) => {
  if (FREEZE_INDEX_PARENT) {
    const isShallowEqual = JSON.stringify(prevProps) === JSON.stringify(nextProps);
    if (isShallowEqual && DEBUG_HISTORY_BLINK) {
      console.info('[HistoryBlink] freezeIndexParent active (blocking re-render on same props)');
      return true; // Skip re-render
    }
  }
  return false; // Always re-render normally
});

// Step 8: Hard-freeze wrapper for IndexParent
let frozenIndexRenderRef: React.ReactElement | null = null;
let indexFreezeLoggedRef = false;

export default function Index() {
  if (FORCE_FREEZE_INDEX_PARENT) {
    if (frozenIndexRenderRef === null) {
      frozenIndexRenderRef = <IndexComponent />;
      if (!indexFreezeLoggedRef) {
        console.info('[HistoryBlink] forceFreezeIndexParent active');
        indexFreezeLoggedRef = true;
      }
    }
    return frozenIndexRenderRef;
  }
  
  if (FREEZE_INDEX_PARENT) {
    return <MemoizedIndexComponent />;
  }
  return <IndexComponent />;
};
