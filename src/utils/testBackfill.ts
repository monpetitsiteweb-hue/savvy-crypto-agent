import { supabase } from '@/integrations/supabase/client';

export const runBackfillTest = async (scope: 'single_user' | 'all_users' = 'single_user') => {
  try {
    console.log(`🔥 TESTING: Running backfill function (${scope})...`);
    
    // Get current user session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.user?.id && scope === 'single_user') {
      throw new Error('No authenticated user found for single_user scope');
    }

    const requestBody = scope === 'single_user' 
      ? { scope: 'single_user', userId: session?.user?.id, mode: 'test' }
      : { scope: 'all_users', mode: 'test' };

    const { data, error } = await supabase.functions.invoke('backfill-sell-snapshots', {
      body: requestBody
    });

    if (error) {
      console.error('❌ BACKFILL TEST: Error:', error);
      return { success: false, error };
    }

    console.log('✅ BACKFILL TEST: Success:', data);
    return { success: true, data };
  } catch (error) {
    console.error('❌ BACKFILL TEST: Exception:', error);
    return { success: false, error };
  }
};