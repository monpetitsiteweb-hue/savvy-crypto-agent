-- Create user profiles table to store additional user information
CREATE TABLE public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  username TEXT UNIQUE,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create coinbase connections table to store encrypted API credentials
CREATE TABLE public.coinbase_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  connection_name TEXT NOT NULL DEFAULT 'Default',
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  is_sandbox BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  connected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_sync TIMESTAMP WITH TIME ZONE,
  UNIQUE(user_id, connection_name)
);

-- Create API connections table for external services (OpenAI, Twitter, RSS, etc.)
CREATE TABLE public.api_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL, -- 'openai', 'twitter', 'rss', 'telegram', etc.
  connection_name TEXT NOT NULL DEFAULT 'Default',
  api_key_encrypted TEXT,
  additional_config JSONB, -- Store service-specific config
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, service_name, connection_name)
);

-- Create trading strategies table
CREATE TABLE public.trading_strategies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_name TEXT NOT NULL,
  description TEXT,
  configuration JSONB NOT NULL, -- Store strategy parameters
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create trading history table
CREATE TABLE public.trading_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strategy_id UUID REFERENCES public.trading_strategies(id) ON DELETE SET NULL,
  coinbase_connection_id UUID REFERENCES public.coinbase_connections(id),
  trade_type TEXT NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  cryptocurrency TEXT NOT NULL,
  amount DECIMAL(20, 8) NOT NULL,
  price DECIMAL(20, 8) NOT NULL,
  fees DECIMAL(20, 8),
  total_value DECIMAL(20, 8) NOT NULL,
  coinbase_order_id TEXT,
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable Row Level Security on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coinbase_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for profiles
CREATE POLICY "Users can view their own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Create RLS policies for coinbase_connections
CREATE POLICY "Users can manage their own coinbase connections" 
  ON public.coinbase_connections FOR ALL 
  USING (user_id = auth.uid());

-- Create RLS policies for api_connections
CREATE POLICY "Users can manage their own API connections" 
  ON public.api_connections FOR ALL 
  USING (user_id = auth.uid());

-- Create RLS policies for trading_strategies
CREATE POLICY "Users can manage their own trading strategies" 
  ON public.trading_strategies FOR ALL 
  USING (user_id = auth.uid());

-- Create RLS policies for trading_history
CREATE POLICY "Users can view their own trading history" 
  ON public.trading_history FOR SELECT 
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own trading history" 
  ON public.trading_history FOR INSERT 
  WITH CHECK (user_id = auth.uid());

-- Create function to handle new user profile creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN new;
END;
$$;

-- Create trigger to automatically create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Create indexes for better performance
CREATE INDEX idx_profiles_username ON public.profiles(username);
CREATE INDEX idx_coinbase_connections_user_id ON public.coinbase_connections(user_id);
CREATE INDEX idx_api_connections_user_service ON public.api_connections(user_id, service_name);
CREATE INDEX idx_trading_strategies_user_id ON public.trading_strategies(user_id);
CREATE INDEX idx_trading_history_user_id ON public.trading_history(user_id);
CREATE INDEX idx_trading_history_executed_at ON public.trading_history(executed_at DESC);