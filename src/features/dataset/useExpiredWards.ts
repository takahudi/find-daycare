import { useEffect, useState } from 'react';
import type { Ward } from '../../schema';
import { isVacancyExpired, nextExpiryDelay } from '../../lib/vacancy-expiry';

export function useExpiredWards(wards: Ward[]) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    const delay = nextExpiryDelay(wards, now);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => setNow(new Date()), delay);
    return () => window.clearTimeout(timer);
  }, [wards, now]);
  // filter/map/join では配列の生成まで時刻依存のキャッシュにまとめられるため、文字列を直接組み立てる。
  let expiredWardKey = '';
  for (const ward of wards) {
    if (isVacancyExpired(ward.admissionDate, now)) expiredWardKey += ward.id + ',';
  }
  const expiredWardIds = new Set(expiredWardKey.split(','));
  return wards.filter((ward) => expiredWardIds.has(ward.id));
}
