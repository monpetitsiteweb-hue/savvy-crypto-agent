-- Step 1: Add column with default (existing rows become TEST)
ALTER TABLE public.portfolio_capital 
ADD COLUMN is_test_mode BOOLEAN NOT NULL DEFAULT true;

-- Step 2: Drop old primary key
ALTER TABLE public.portfolio_capital 
DROP CONSTRAINT portfolio_capital_pkey;

-- Step 3: Create composite primary key
ALTER TABLE public.portfolio_capital 
ADD CONSTRAINT portfolio_capital_pkey 
PRIMARY KEY (user_id, is_test_mode);

-- Step 4: Add index for mode-scoped queries
CREATE INDEX idx_portfolio_capital_mode 
ON public.portfolio_capital(is_test_mode);