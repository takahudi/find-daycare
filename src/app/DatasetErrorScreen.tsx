import { SiteTitle } from '../features/dataset/SiteTitle';
import { ThemeToggle } from './ThemeToggle';
import styles from './App.module.css';

export default function DatasetErrorScreen({ error }: { error: Error }) {
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.topbarHeading}>
          <SiteTitle area="大阪市" />
        </div>
        <div className={styles.topbarTheme}>
          <ThemeToggle />
        </div>
      </header>
      <main className={styles.list}>
        <div role="alert">
          <p>施設データを読み込めませんでした。</p>
          <p>{error.message}</p>
        </div>
        <button type="button" className="link-button" onClick={() => location.reload()}>
          再読み込み
        </button>
      </main>
    </div>
  );
}
