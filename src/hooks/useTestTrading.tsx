import { useIntelligentTradingEngine } from './useIntelligentTradingEngine';

export const useTestTrading = () => {
  console.log('🚨 HOOK_INIT: useTestTrading hook is being called - DELEGATING TO INTELLIGENT ENGINE');
  
  // Delegate to the new intelligent trading engine
  const { checkStrategiesAndExecute } = useIntelligentTradingEngine();
  
  return { checkStrategiesAndExecute };
};

// The rest of this file is now handled by useIntelligentTradingEngine.tsx
// Keeping minimal structure for backwards compatibility