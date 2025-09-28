import { ExecutionConnector, QuoteReq, QuoteRes, PlaceRes } from '../types';

// Skeleton: wraps existing CEX path later. For now, safe placeholders.
export class CoinbaseConnector implements ExecutionConnector {
  async getQuote(req: QuoteReq): Promise<QuoteRes> {
    // Placeholder: return a large effectiveBpsCost so MetaRouter will ignore it for ONCHAIN mode.
    return {
      provider: 'coinbase',
      price: Number.NaN,
      quoteTs: Date.now(),
      effectiveBpsCost: Number.POSITIVE_INFINITY,
    };
  }
  async place(_req: QuoteReq, _best: QuoteRes): Promise<PlaceRes> {
    return { status: 'FAILED' };
  }
  async getStatus(_ref: string): Promise<'PENDING' | 'FILLED' | 'FAILED'> { 
    return 'FAILED'; 
  }
}