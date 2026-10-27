import { SiteTitle } from '../features/dataset/SiteTitle';
import styles from './App.module.css';

export default function DatasetErrorScreen({ error }: { error: Error }) {
  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <SiteTitle area="大阪市" />
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
