import { ExecutionConnector, QuoteReq, QuoteRes, PlaceRes } from '../types';
import { fetchZeroExQuote } from '../../lib/api/onchain';

export class ZeroExConnector implements ExecutionConnector {
  async getQuote(req: QuoteReq): Promise<QuoteRes> {
    try {
      const payload = {
        chainId: req.chainId,
        base: req.base,
        quote: req.quote,
        side: req.side,
        amount: req.amount,
        slippageBps: req.slippageBps,
      };

      const result = await fetchZeroExQuote(payload);
      
      // If the response contains an error, throw to let MetaRouter ignore this provider
      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (error) {
      console.error('ZeroExConnector getQuote error:', error);
      throw error; // Let MetaRouter handle this
    }
  }
  async place(_req: QuoteReq, _best: QuoteRes): Promise<PlaceRes> { 
    return { status: 'FAILED' }; 
  }
  async getStatus(_ref: string): Promise<'PENDING' | 'FILLED' | 'FAILED'> { 
    return 'FAILED'; 
  }
}