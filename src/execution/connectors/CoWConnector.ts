import { ExecutionConnector, QuoteReq, QuoteRes, PlaceRes } from '../types';

export class CoWConnector implements ExecutionConnector {
  async getQuote(_req: QuoteReq): Promise<QuoteRes> {
    return {
      provider: 'cow',
      price: Number.NaN,
      mevRoute: 'cow_intent',
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