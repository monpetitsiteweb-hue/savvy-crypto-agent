import { ExecutionConnector, QuoteReq, QuoteRes } from './types';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function bestQuote(req: QuoteReq, connectors: ExecutionConnector[], timeoutMs = 600): Promise<QuoteRes> {
  const results = await Promise.allSettled(connectors.map(c => withTimeout(c.getQuote(req), timeoutMs)));
  const ok = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value as QuoteRes);
  if (!ok.length) throw new Error('No viable quotes');
  ok.sort((a, b) => a.effectiveBpsCost - b.effectiveBpsCost);
  return ok[0];
}