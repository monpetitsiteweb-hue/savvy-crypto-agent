// Global error capturing for debugging
if (typeof window !== 'undefined') {
  window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.error || e.message || e);
  });
  
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[UnhandledRejection]', e.reason);
  });
  
  console.error('[ErrorTap] active');
}