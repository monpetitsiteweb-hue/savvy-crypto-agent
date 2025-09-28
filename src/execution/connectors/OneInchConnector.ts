import { ExecutionConnector, QuoteReq, QuoteRes, PlaceRes } from '../types';

export class OneInchConnector implements ExecutionConnector {
  async getQuote(req: QuoteReq): Promise<QuoteRes> {
    return {
      provider: '1inch',
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