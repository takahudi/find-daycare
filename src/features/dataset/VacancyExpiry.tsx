import type { Ward } from '../../schema';
import { vacancyExpiryMessage } from '../../lib/vacancy-expiry';
import styles from './VacancyExpiry.module.css';

export function VacancyExpiryWarning({ expiredWards, wardCount }: { expiredWards: Ward[]; wardCount: number }) {
  const message = vacancyExpiryMessage(expiredWards, wardCount);
  if (!message) return null;
  return (
    <p role="note" aria-label="入所日を過ぎた空き情報" className={styles.warning}>
      {message}
    </p>
  );
}

export function VacancyExpiryBadge() {
  return <span className={styles.badge}>入所日を過ぎた空き情報</span>;
}
