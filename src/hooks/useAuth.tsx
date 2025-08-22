
import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  console.log('🔑 AuthProvider: Component is mounting!');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  console.log('🔑 AuthProvider: State initialized, about to run useEffect');

  useEffect(() => {
    console.log('🔑 AuthProvider: useEffect is running!');
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        // Get initial session
        const { data: { session }, error } = await supabase.auth.getSession();
        console.log('🔑 AuthProvider: Initial session check - User:', session?.user?.email, 'User ID:', session?.user?.id, 'Session exists:', !!session, 'Error:', error);
        console.log('🔑 AuthProvider: Full session object:', session);
        console.log('🔑 AuthProvider: localStorage auth data:', localStorage.getItem('sb-fuieplftlcxdfkxyqzlt-auth-token'));
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);
          console.log('🔑 AuthProvider: Setting user state to:', session?.user?.email || 'null');
        }
      } catch (err) {
        console.error('🔑 AuthProvider: Error getting session:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    };
    
    // Set up auth state listener first
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('🔑 AuthProvider: Auth state change:', event, 'User:', session?.user?.email, 'User ID:', session?.user?.id, 'Session exists:', !!session);
      console.log('🔑 AuthProvider: Full auth state change session:', session);
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);
        console.log('🔑 AuthProvider: Updated user state to:', session?.user?.email || 'null');
        if (!session) {
          setLoading(false);
        } else {
          setLoading(false);
        }
      }
    });

    // Initialize auth after setting up listener
    initializeAuth();

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const value = {
    user,
    session,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
