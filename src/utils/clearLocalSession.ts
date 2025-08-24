// Utility to clear all client-side storage for legacy users
export function clearAllClientStorage() {
  // Clear localStorage
  localStorage.clear();
  
  // Clear sessionStorage
  sessionStorage.clear();
  
  // Clear all cookies
  document.cookie.split(";").forEach((c) => {
    const eqPos = c.indexOf("=");
    const name = eqPos > -1 ? c.substr(0, eqPos) : c;
    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=" + window.location.hostname;
  });
}

// Version-based storage reset
const APP_VERSION = 'v2.2.0';

export function checkAndClearLegacyStorage() {
  const hasResetOnce = localStorage.getItem('storageResetOnce');
  const storedVersion = localStorage.getItem('app_version');
  
  // Clear storage if it's the first time or version has changed
  if (!hasResetOnce || storedVersion !== APP_VERSION) {
    clearAllClientStorage();
    localStorage.setItem('storageResetOnce', 'true');
    localStorage.setItem('app_version', APP_VERSION);
    
    // Force a clean reload to ensure all cached data is cleared
    window.location.reload();
    return true;
  }
  
  return false;
}