import type { HomeChoice, useHome } from './useHome';
import styles from './HomeForm.module.css';

interface Props {
  state: ReturnType<typeof useHome>;
  onHomeChosen: (source: HomeChoice) => void;
  statusClassName?: string;
}

export function HomeForm({ state, onHomeChosen, statusClassName }: Props) {
  const { home, address, setAddress, searching, error, search, locateMe, clearHome } = state;
  return (
    <>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          search(onHomeChosen);
        }}
      >
        <label htmlFor="address" className="visually-hidden">
          自宅の住所
        </label>
        <input
          id="address"
          type="search"
          placeholder="自宅の住所（例：中之島1-3、阿倍野区文の里1丁目）"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          autoComplete="street-address"
        />
        <button type="submit" disabled={searching}>
          {searching ? '検索中…' : '近い順に並べる'}
        </button>
        <button type="button" className={styles.ghost} onClick={() => locateMe(onHomeChosen)}>
          現在地
        </button>
      </form>
      {(home || error) && (
        <p className={`${styles.status} ${statusClassName ?? ''}${error ? ` ${styles.error}` : ''}`} role="status">
          {error ?? (
            <>
              🏠 <strong>{home!.label}</strong> からの直線距離で表示中
              <button type="button" className="link-button" onClick={clearHome}>
                解除
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
