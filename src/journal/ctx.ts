import type { Journal } from '../core/journal';

/** 화면 조각들이 함께 쓰는 것. journal은 그릴 때마다 저장소에서 다시 읽은 최신 값 */
export interface Ctx {
  readonly journal: Journal;
  /** 저장하고 다시 그린다 */
  persist(): void;
  rerender(): void;
  toast(msg: string): void;
  now(): number;
}
