// Fix duplicate Database identifier by not redeclaring it
import type { Database } from '@/types/supabase';

declare module '@/types/supabase' {
  namespace Database {
    namespace public {
      interface Tables extends Database['public']['Tables'] {
        whale_signal_events: {
          Row: {
            id: string;
            created_at: string;
            symbol: string;
            side: string;
            size: number;
            source: string;
            metadata?: unknown;
            user_id?: string | null;
          };
          Insert: Partial<Database['public']['Tables']['whale_signal_events']['Row']>;
          Update: Partial<Database['public']['Tables']['whale_signal_events']['Row']>;
          Relationships: [];
        };
      }
    }
  }
}