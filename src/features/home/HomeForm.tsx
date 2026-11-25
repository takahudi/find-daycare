import { useEffect, useRef, useState } from 'react';
import type { Home } from '../../schema';
import { formatHomeLabel } from './home-label';
import { useHomeSearch, type HomeChoice } from './useHome';
import styles from './HomeForm.module.css';

interface Props {
  home: Home | null;
  wardNames: string[];
  setHome: (home: Home | null) => void;
  clearHome: () => void;
  onHomeChosen: (source: HomeChoice) => void;
}

export function HomeForm({ home, wardNames, setHome, clearHome, onHomeChosen }: Props) {
  const { address, setAddress, searching, error, search, locateMe } = useHomeSearch(wardNames, setHome);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleHomeChosen = (source: HomeChoice) => {
    setEditing(false);
    onHomeChosen(source);
  };

  const handleClearHome = () => {
    setEditing(false);
    clearHome();
  };

  const displayLabel = home ? formatHomeLabel(home.label) : '';

  if (home && !editing) {
    return (
      <div className={styles.root}>
        <div className={styles.homeBar}>
          <p className={styles.status} role="status">
            <span aria-hidden="true">🏠</span>{' '}
            <strong className={styles.homeLabel} title={home.label}>
              {displayLabel}
            </strong>
            <span className={styles.statusSuffix}> からの直線距離</span>
          </p>
          <div className={styles.homeActions}>
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              変更
            </button>
            <button type="button" className="link-button" onClick={handleClearHome}>
              解除
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <form
        className={styles.search}
        onSubmit={(e) => {
          e.preventDefault();
          search(handleHomeChosen);
        }}
      >
        <label htmlFor="address" className="visually-hidden">
          自宅の住所
        </label>
        <input
          ref={inputRef}
          id="address"
          type="search"
          placeholder="自宅の住所（例：中之島1-3）"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && editing) setEditing(false);
          }}
          autoComplete="street-address"
        />
        <button type="submit" className={styles.submit} disabled={searching} title={searching ? '検索中…' : '近い順に並べる'}>
          <svg
            className={styles.submitIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className={styles.submitText}>{searching ? '検索中…' : '近い順に並べる'}</span>
        </button>
        <button type="button" className={styles.ghost} onClick={() => locateMe(handleHomeChosen)}>
          現在地
        </button>
      </form>
      {(error || (home && editing)) && (
        <div className={styles.editMeta}>
          {error ? (
            <p className={`${styles.status} ${styles.error}`} role="status">
              {error}
            </p>
          ) : (
            <p className={styles.status} role="status">
              <span aria-hidden="true">🏠</span>{' '}
              <strong className={styles.homeLabel} title={home!.label}>
                {displayLabel}
              </strong>
              <span className={styles.statusSuffix}> からの直線距離</span>
            </p>
          )}
          {home && editing && (
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              キャンセル
            </button>
          )}
        </div>
      )}
    </div>
  );
}
