// Helper functions for managing test mode
export const setGlobalTestMode = (enabled: boolean) => {
  // Store in localStorage for persistence
  localStorage.setItem('global-test-mode', JSON.stringify(enabled));
  
  // Dispatch a custom event to notify components of the change
  window.dispatchEvent(new CustomEvent('testModeChanged', { 
    detail: { enabled } 
  }));
  
  return enabled;
};

export const getGlobalTestMode = (): boolean => {
  const saved = localStorage.getItem('global-test-mode');
  return saved ? JSON.parse(saved) : false;
};

export const toggleGlobalTestMode = (): boolean => {
  const current = getGlobalTestMode();
  return setGlobalTestMode(!current);
};