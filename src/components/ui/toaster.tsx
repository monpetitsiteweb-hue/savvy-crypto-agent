import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  // Step 11: Check for animation suppression
  const shouldSuppressAnimations = (() => {
    try {
      const url = new URL(window.location.href);
      const isDebugHistory = url.searchParams.get('debug') === 'history';
      const muteNotifAnim = url.searchParams.get('muteNotifAnim') === '1';
      const isHistoryRoute = window.location.pathname === '/' && 
        (url.searchParams.get('tab') === 'history' || window.location.hash.includes('history'));
      
      return isDebugHistory && muteNotifAnim && isHistoryRoute;
    } catch {
      return false;
    }
  })();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast 
            key={id} 
            {...props}
            className={`${props.className || ''} ${shouldSuppressAnimations ? 'no-animation' : ''}`}
          >
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
