// worker/index.js의 형식 (단위 시험에서 불러오려고)
declare const worker: {
  fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }): Promise<Response>;
};
export default worker;
