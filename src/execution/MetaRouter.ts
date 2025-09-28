import { ExecutionConnector, QuoteReq, QuoteRes } from './types';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function bestQuote(
  req: QuoteReq, 
  connectors: ExecutionConnector[], 
  timeoutMs = 600, 
  preferredOrder?: Array<'0x' | 'cow' | '1inch' | 'uniswap'>, 
  tieBps = 2
): Promise<QuoteRes> {
  const results = await Promise.allSettled(connectors.map(c => withTimeout(c.getQuote(req), timeoutMs)));
  const ok = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value as QuoteRes);
  if (!ok.length) throw new Error('No viable quotes');
  
  // Sort by effective BPS cost
  ok.sort((a, b) => a.effectiveBpsCost - b.effectiveBpsCost);
  
  // Handle tie-breaking if preferredOrder is provided
  if (preferredOrder && ok.length > 1) {
    const best = ok[0];
    const tieBreakers = ok.filter(quote => 
      Math.abs(quote.effectiveBpsCost - best.effectiveBpsCost) <= tieBps
    );
    
    if (tieBreakers.length > 1) {
      // Find the most preferred provider among tie-breakers
      for (const provider of preferredOrder) {
        const preferred = tieBreakers.find(q => q.provider === provider);
        if (preferred) {
          console.log(`Tie-break: choosing ${provider} over others within ${tieBps} bps`);
          return preferred;
        }
      }
    }
  }
  
  return ok[0];
}