// worker/stocks.js의 형식 (단위 시험에서 불러오려고)
export declare const MAX_SYMBOLS: number;
export declare function stockQuote(request: Request, env: { FINNHUB_KEY?: string }, upstreamFetch?: (url: string, init?: RequestInit & { cf?: unknown }) => Promise<Response>): Promise<Response>;
