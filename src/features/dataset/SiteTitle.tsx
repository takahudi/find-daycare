import styles from './SiteTitle.module.css';

export function SiteTitle({ area, title }: { area: string; title?: string }) {
  return (
    <h1 className={styles.heading} title={title}>
      {area}の保育施設 <span>空き状況マップ</span>
    </h1>
  );
}
