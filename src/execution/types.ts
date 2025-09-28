export type Side = 'BUY' | 'SELL';
export type Mode = 'COINBASE' | 'ONCHAIN';

export interface QuoteReq {
  mode: Mode;
  chainId?: number;       // on-chain only
  base: string;           // e.g. 'ETH'
  quote: string;          // e.g. 'USDC'
  side: Side;
  amount: number;         // BUY: spend in quote; SELL: sell in base
  slippageBps?: number;
}

export interface QuoteRes {
  provider: 'coinbase' | '0x' | 'cow' | '1inch' | 'uniswap';
  price: number;              // quote/base
  gasCostQuote?: number;      // gas converted to quote currency
  feePct?: number;            // protocol/RFQ/affiliate
  minOut?: string;            // on-chain safety
  priceImpactBps?: number;    // AMM hint
  mevRoute?: 'private_rpc' | 'public' | 'cow_intent';
  quoteTs: number;
  raw?: unknown;
  effectiveBpsCost: number;   // includes gas & fees
}

export interface PlaceRes {
  id?: string;       // CEX order id
  txHash?: string;   // on-chain
  status: 'PENDING' | 'FILLED' | 'FAILED';
}

export interface ExecutionConnector {
  getQuote(req: QuoteReq): Promise<QuoteRes>;
  place(req: QuoteReq, best: QuoteRes): Promise<PlaceRes>;
  getStatus(ref: string): Promise<'PENDING' | 'FILLED' | 'FAILED'>;
}