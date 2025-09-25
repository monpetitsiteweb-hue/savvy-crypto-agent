// Augment the generated Database type with extra tables/views used by the app.
// This prevents build breaks when a table isn't present in generated types yet.

import type { Database as GenDatabase } from '@/types/supabase';

declare module '@/types/supabase' {
  // Extend the Database type with additional relations
  export interface Database extends GenDatabase {
    public: GenDatabase['public'] & {
      Tables: GenDatabase['public']['Tables'] & {
        whale_signal_events: {
          Row: {
            id: string;
            created_at: string;
            symbol: string;
            side: string;        // 'buy'|'sell' or string
            size: number;
            source: string;      // e.g., 'whale', 'news'
            metadata?: unknown;
            user_id?: string | null;
          };
          Insert: Partial<Database['public']['Tables']['whale_signal_events']['Row']>;
          Update: Partial<Database['public']['Tables']['whale_signal_events']['Row']>;
          Relationships: [];
        };
      };
      Views: GenDatabase['public']['Views'];
      Functions: GenDatabase['public']['Functions'];
    };
  }
}