# 검증 보고서 (2026-10-18)

실행 환경: Linux, Node 22.22.0, Chromium 153 (headless). 이 환경에서는 Bybit 서버(api.bybit.com, stream.bybit.com) 접속이 차단되어 있습니다.

## 실행한 명령과 결과

| 명령 | 결과 |
|---|---|
| `npx vitest run` | 21개 파일, 165개 테스트 통과 |
| `npm run build` (타입 검사 + 빌드) | 오류 없음 |
| `PW_CHROMIUM_PATH=… npx playwright test` | 17개 통과 (데모 11, 가짜 Bybit 6) |
| `node scripts/check-bybit.mjs` (실제 Bybit) | 7개 항목 모두 FAIL — 네트워크 차단(ENOTFOUND). 앱 결함이 아니라 환경 제약 |
| `BYBIT_REST=… BYBIT_WS=… node scripts/check-bybit.mjs` (가짜 Bybit) | 7개 PASS, 종료 코드 0 — 스크립트의 성공 경로 확인 |

## 요구사항 검증 항목

| 원본 요구사항 검증 항목 | 근거 | 상태 |
|---|---|---|
| LONG/SHORT별 SL·TP·RR 계산 (예시 4개) | `metrics.test.ts` 예시 4개 + 레퍼런스 이미지 수치(1:1.53), `scenario.test.ts › spec example flow` | 통과 |
| 클릭 순간 엔트리 고정 | `freshness.test.ts › captureEntry`, E2E `entry stays fixed while price moves` (60배속, 새 캔들 생성 후에도 엔트리·자동값·적용값 불변) | 통과 (데모) |
| 엔트리 이후 데이터를 쓰지 않는 자동 선정 | `analysis.test.ts › bigger spike after cutoff is ignored`, `unconfirmed candle is ignored`, `swing confirmed after cutoff is not used` | 통과 |
| SL 수정 시 TP 유지, TP 수정 시 SL 유지 | `scenario.test.ts › setLevel …`, `drag.test.ts › dragging TP keeps SL`, E2E 드래그 테스트 | 통과 |
| 드래그 중 실시간 RR 갱신 | `drag.test.ts › drag updates RR in real time` (2.4 → 2), E2E에서 마우스를 누른 채 RR 표시 변경 확인 | 통과 |
| 드래그가 차트 이동과 충돌하지 않음 | E2E 드래그 테스트의 표시 범위 불변 검사. 보호 코드를 빼면 실패하는 것 확인(뮤테이션 검사) | 통과 |
| 차트 조작 후 도형 좌표 일치 | E2E `geometry matches coordinates after zoom and scroll`. 좌표 재계산을 막으면 실패하는 것 확인(뮤테이션 검사) | 통과 |
| 데이터 연결 중단과 재연결 | `socket.test.ts` (백오프 1s→2s, 최대값, 재구독, 무응답 감시), E2E 데모 끊김, E2E 가짜 Bybit 강제 종료 후 재연결·재구독 | 통과 (데모·가짜 서버) |
| 새로고침 후 복원 | `persistence.test.ts`, E2E `reload restores scenario and manual edits` | 통과 |
| 실시간 차트 추종 (kline 푸시 사이에도 마지막 캔들이 체결가를 따라감) | `liveCandle.test.ts`, E2E `last candle follows trades between slow kline pushes` (가짜 서버 kline 5초 간격). 수정 전 같은 테스트가 실패하는 것 확인 | 통과 (가짜 서버) |
| 자동 제안값 복원 | `scenario.test.ts › restoreAuto …`, E2E `restore auto returns creation values` | 통과 |

## 실패 상황 처리

| 상황 | 근거 | 상태 |
|---|---|---|
| Bybit REST 실패(HTTP 403) | E2E: 오류 원인(403)이 배너로 보이고, 데모로 바꾸면 정상 동작 | 통과 (가짜 서버) |
| 상위 시간봉 조회 실패 | E2E: 시나리오는 만들어지고 TP는 "상위 시간봉 데이터 조회 실패" 사유와 함께 비워 둠 | 통과 (가짜 서버) |
| 저장소 접근 자체가 막힌 브라우저 | `safeStorage.test.ts`: 메모리 저장소로 대체(새로고침하면 사라짐) | 통과 |
| 현재 공급원에 없는 종목의 시나리오 | E2E: "그 종목 보기"가 이동하지 않고 안내만 표시 | 통과 |

## 직접 확인하지 못한 것 (검증 완료 아님)

- **실제 Bybit 서버와의 연결**: REST 응답, 웹소켓 메시지 형식이 공식 문서와 같은지. 문서 예시와 그 형식을 따르는 가짜 서버로만 확인했습니다. → `npm run check:bybit`로 확인 필요
- **한국 IP에서 Bybit API 접속 가능 여부**
- **Bybit REST의 CORS 허용 여부**: 확인하지 못해 개발 서버 프록시를 씁니다. 정적 호스팅으로 배포하려면 별도 확인이 필요합니다.
- **실제 시세에서 자동 SL/TP가 무효로 나오는 빈도**: 데모 데이터에서는 자동 TP가 엔트리에 매우 가까워 RR이 1:0.03처럼 작게 나오는 경우를 봤습니다. "가장 최근 확정 스윙" 규칙의 성격일 수 있으니 실제 데이터로 확인이 필요합니다.
- **터치 기기(휴대폰)에서의 드래그**: 마우스로만 검증했습니다. 390px 화면 배치는 스크린샷으로 확인했습니다.
- **Windows/macOS의 Chrome·Safari·Firefox**: 리눅스 headless Chromium에서만 실행했습니다.
