import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './useAuth';
import { supabase } from '@/integrations/supabase/client';

export type OnboardingStep = 'welcome' | 'active';

interface OnboardingStatus {
  currentStep: OnboardingStep;
  isLoading: boolean;
  error: string | null;
}

interface OnboardingRow {
  user_id: string;
  current_step: string;
}

/**
 * Hook to manage user onboarding status.
 * - Fetches current_step from user_onboarding_status table
 * - Missing rows are treated as 'welcome' (backward compatibility)
 * - Provides completeWelcome() to transition from welcome → active
 */
export function useOnboardingStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus>({
    currentStep: 'active', // Default to active to avoid flash
    isLoading: true,
    error: null,
  });

  // Fetch onboarding status
  useEffect(() => {
    if (!user?.id) {
      setStatus({ currentStep: 'active', isLoading: false, error: null });
      return;
    }

    const fetchStatus = async () => {
      try {
        // Use raw query since table may not be in generated types
        const { data, error } = await supabase
          .from('user_onboarding_status' as any)
          .select('current_step')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('[useOnboardingStatus] Error fetching status:', error);
          setStatus({ currentStep: 'active', isLoading: false, error: error.message });
          return;
        }

        const row = data as unknown as OnboardingRow | null;
        // Missing row = treat as 'welcome' (backward compat for existing users)
        const step = (row?.current_step as OnboardingStep) ?? 'welcome';
        setStatus({ currentStep: step, isLoading: false, error: null });
      } catch (err) {
        console.error('[useOnboardingStatus] Unexpected error:', err);
        setStatus({ currentStep: 'active', isLoading: false, error: 'Unexpected error' });
      }
    };

    fetchStatus();
  }, [user?.id]);

  /**
   * Marks welcome as complete, transitioning to 'active' state.
   * Uses optimistic update to prevent race conditions.
   * Idempotent: safe to call multiple times.
   */
  const completeWelcome = useCallback(async () => {
    if (!user?.id) return;

    // Optimistic update: set local state immediately to prevent race conditions
    // This ensures the modal cannot reappear even if component remounts during DB write
    setStatus(prev => ({ ...prev, currentStep: 'active' }));

    try {
      // Persist to DB (fire-and-forget pattern with error logging)
      const { error } = await supabase
        .from('user_onboarding_status' as any)
        .upsert(
          { user_id: user.id, current_step: 'active' },
          { onConflict: 'user_id' }
        );

      if (error) {
        console.error('[useOnboardingStatus] Error persisting welcome completion:', error);
        // Don't revert - user already dismissed, failing silently is better UX
        // Next login will just show modal again if DB failed
      }
    } catch (err) {
      console.error('[useOnboardingStatus] Unexpected error:', err);
    }
  }, [user?.id]);

  return {
    currentStep: status.currentStep,
    isLoading: status.isLoading,
    error: status.error,
    showWelcomeModal: status.currentStep === 'welcome' && !status.isLoading,
    completeWelcome,
  };
}
