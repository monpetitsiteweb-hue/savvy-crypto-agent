/**
 * RealPortfolioNotInitialized
 * 
 * REAL MODE ONLY - This component replaces PortfolioNotInitialized for REAL mode.
 * 
 * KEY DIFFERENCE FROM TEST MODE:
 * - TEST mode: Shows "Initialize Portfolio" button to create €30k mock capital
 * - REAL mode: Shows state-driven funding flow - capital comes from on-chain deposits ONLY
 * 
 * REAL portfolio can ONLY be created via:
 * 1. User registers external wallet address
 * 2. User sends funds from that address to system wallet
 * 3. System automatically attributes deposit and creates portfolio_capital
 * 
 * There is NO initialize button for REAL mode.
 */
import { RealFundingFlowManager } from "./wallet/RealFundingFlowManager";

interface RealPortfolioNotInitializedProps {
  onWalletAdded?: () => void;
}

export function RealPortfolioNotInitialized({ onWalletAdded }: RealPortfolioNotInitializedProps) {
  return <RealFundingFlowManager onPortfolioFunded={onWalletAdded} />;
}
