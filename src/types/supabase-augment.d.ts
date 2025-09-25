import type { Database as GenDatabase } from '@/types/supabase';

declare module '@/types/supabase' {
  namespace Database {
    namespace public {
      interface Tables {
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
          Insert: {
            id?: string;
            created_at?: string;
            symbol: string;
            side: string;
            size: number;
            source: string;
            metadata?: unknown;
            user_id?: string | null;
          };
          Update: {
            id?: string;
            created_at?: string;
            symbol?: string;
            side?: string;
            size?: number;
            source?: string;
            metadata?: unknown;
            user_id?: string | null;
          };
          Relationships: [];
        };
      }
    }
  }
}