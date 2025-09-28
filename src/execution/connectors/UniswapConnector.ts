import { ExecutionConnector, QuoteReq, QuoteRes, PlaceRes } from '../types';
import { fetchOnchainQuote } from '@/lib/api/onchain';

export class UniswapConnector implements ExecutionConnector {
  async getQuote(req: QuoteReq): Promise<QuoteRes> {
    if (req.mode !== 'ONCHAIN') {
      return {
        provider: 'uniswap',
        price: Number.NaN,
        quoteTs: Date.now(),
        effectiveBpsCost: Number.POSITIVE_INFINITY,
      };
    }

    try {
      const result = await fetchOnchainQuote({
        chainId: req.chainId!,
        base: req.base,
        quote: req.quote,
        side: req.side,
        amount: req.amount,
        slippageBps: req.slippageBps,
        provider: 'uniswap',
      });

      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (error) {
      console.error('Uniswap quote error:', error);
      return {
        provider: 'uniswap',
        price: Number.NaN,
        quoteTs: Date.now(),
        effectiveBpsCost: Number.POSITIVE_INFINITY,
      };
    }
  }

  async place(_req: QuoteReq, _best: QuoteRes): Promise<PlaceRes> { 
    return { status: 'FAILED' }; 
  }
  
  async getStatus(_ref: string): Promise<'PENDING' | 'FILLED' | 'FAILED'> { 
    return 'FAILED'; 
  }
}