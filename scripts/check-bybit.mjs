#!/usr/bin/env node
// Bybit 공개 시세 연결 점검 (Node 22 이상: 내장 fetch·WebSocket 사용)
// 사용법: npm run check:bybit [-- 종목]   예) npm run check:bybit -- ETHUSDT
// 이 앱이 쓰는 것과 같은 REST·WebSocket 경로를 직접 호출해 항목별 PASS/FAIL을 출력한다.

const REST = process.env.BYBIT_REST ?? 'https://api.bybit.com';
const WS_URL = process.env.BYBIT_WS ?? 'wss://stream.bybit.com/v5/public/linear';
const SYMBOL = (process.argv[2] ?? 'BTCUSDT').toUpperCase();
const WAIT_MS = 15_000;

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

async function getJson(path, headers = {}) {
  const res = await fetch(`${REST}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function checkRest() {
  try {
    const { res, body } = await getJson(`/v5/market/instruments-info?category=linear&symbol=${SYMBOL}`);
    const item = body?.result?.list?.[0];
    const tick = item?.priceFilter?.tickSize;
    record('종목 정보 (instruments-info)', res.ok && body?.retCode === 0 && !!tick,
      res.ok ? `retCode=${body?.retCode} tickSize=${tick} status=${item?.status}` : `HTTP ${res.status}`);
  } catch (e) {
    record('종목 정보 (instruments-info)', false, String(e?.cause?.code ?? e?.message ?? e));
  }

  try {
    const { res, body } = await getJson(`/v5/market/kline?category=linear&symbol=${SYMBOL}&interval=15&limit=200`, {
      Origin: 'http://localhost:5173',
    });
    const list = body?.result?.list ?? [];
    const newestFirst = list.length > 1 && Number(list[0][0]) > Number(list[1][0]);
    const notFuture = list.length > 0 && Number(list[0][0]) <= Number(body?.time ?? Date.now());
    record('15분봉 200개 (kline)', res.ok && body?.retCode === 0 && list.length === 200 && newestFirst && notFuture,
      res.ok ? `개수=${list.length} 최신순=${newestFirst} 서버시각=${body?.time}` : `HTTP ${res.status}`);
    record('브라우저 직접 호출 허용(CORS) 헤더', null,
      `access-control-allow-origin=${res.headers.get('access-control-allow-origin') ?? '(없음)'} — 앱은 개발 서버 프록시를 쓰므로 없어도 동작`);
  } catch (e) {
    record('15분봉 200개 (kline)', false, String(e?.cause?.code ?? e?.message ?? e));
  }
}

function checkWs() {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      record('웹소켓', false, `이 Node(${process.version})에는 내장 WebSocket이 없습니다. Node 22 이상을 쓰세요.`);
      resolve();
      return;
    }
    const seen = { ack: false, pong: false, trade: false, kline: false, ticker: false };
    let ws;
    let done = false;
    const finish = (note) => {
      if (done) return; // close()가 error 이벤트를 다시 부를 수 있으므로 한 번만 처리
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch { /* 무시 */ }
      record('웹소켓 연결·구독 응답', seen.ack, note ?? '');
      record('웹소켓 퐁 (ping 응답)', seen.pong);
      record('웹소켓 체결 (publicTrade)', seen.trade);
      record('웹소켓 1분봉 (kline)', seen.kline);
      record('웹소켓 티커 (tickers)', seen.ticker);
      resolve();
    };
    const timer = setTimeout(() => finish(`${WAIT_MS / 1000}초 대기 종료`), WAIT_MS);
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      finish(String(e?.message ?? e));
      return;
    }
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ op: 'subscribe', args: [`kline.1.${SYMBOL}`, `publicTrade.${SYMBOL}`, `tickers.${SYMBOL}`] }));
      ws.send(JSON.stringify({ op: 'ping' }));
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.op === 'subscribe' && m.success) seen.ack = true;
      if (m.op === 'pong' || m.ret_msg === 'pong') seen.pong = true;
      if (typeof m.topic === 'string') {
        if (m.topic.startsWith('publicTrade.')) seen.trade = true;
        if (m.topic.startsWith('kline.')) seen.kline = true;
        if (m.topic.startsWith('tickers.')) seen.ticker = true;
      }
      if (Object.values(seen).every(Boolean)) finish('모든 메시지 수신');
    });
    ws.addEventListener('error', (ev) => finish(`오류: ${ev?.message ?? '연결 실패'}`));
  });
}

console.log(`Bybit 연결 점검: ${SYMBOL}\nREST ${REST}\nWS   ${WS_URL}\n`);
await checkRest();
await checkWs();
const failed = results.filter((r) => r.ok === false).length;
console.log(`\n결과: 실패 ${failed}개`);
process.exit(failed ? 1 : 0);
