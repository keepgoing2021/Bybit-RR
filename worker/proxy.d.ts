// worker/proxy.js의 형식 (단위 시험에서 불러오려고)
export declare const ALLOWED: Record<string, number>;
export declare const MAX_QUERY: number;
export declare function proxy(request: Request, upstreamFetch?: (url: string, init?: RequestInit & { cf?: unknown }) => Promise<Response>): Promise<Response>;
