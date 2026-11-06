// worker/tv.js의 형식 (단위 시험·개발 서버에서 불러오려고)
export declare function extractTvSymbols(html: string): string[] | null;
export declare function tvWatchlist(request: Request, upstreamFetch?: (url: string, init?: RequestInit & { cf?: unknown }) => Promise<Response>): Promise<Response>;
