import type { Facility } from '../types';

export const AGES = [0, 1, 2, 3, 4, 5] as const;
export const AGE_LABELS = AGES.map((a) => `${a}歳`);

/** 選んだ年齢クラスのうち、受け入れている年齢があるか（未選択なら常に true） */
export const acceptsAny = (f: Facility, ages: number[]) =>
  ages.length === 0 || ages.some((a) => f.vacancies[a] !== null);

/** 選んだ年齢クラスの空き人数の合計（未選択なら全年齢の合計）。年齢をまたぐ共有枠は1回だけ数える */
export function vacancyCount(f: Facility, ages: number[]): number {
  const target: readonly number[] = ages.length ? ages : AGES;
  const shared = f.sharedVacancy;
  const own = target.reduce((sum, a) => sum + (shared?.ages.includes(a) ? 0 : (f.vacancies[a] ?? 0)), 0);
  return own + (shared && shared.ages.some((a) => target.includes(a)) ? shared.count : 0);
}
