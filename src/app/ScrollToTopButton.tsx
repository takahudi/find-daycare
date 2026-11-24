import { useEffect, useState, type RefObject } from 'react';
import { cancelScrollToFacility } from '../features/facilities/scroll-to-facility';
import styles from './ScrollToTopButton.module.css';

const WINDOW_SCROLL_THRESHOLD = 100;
const LIST_SCROLL_THRESHOLD = 200;

interface Props {
  listRef: RefObject<HTMLElement | null>;
  mobileView: 'list' | 'map';
}

export function ScrollToTopButton({ listRef, mobileView }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    const sync = () => {
      setVisible(window.scrollY >= WINDOW_SCROLL_THRESHOLD || (list !== null && list.scrollTop >= LIST_SCROLL_THRESHOLD));
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(document.documentElement);
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    list?.addEventListener('scroll', sync, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      list?.removeEventListener('scroll', sync);
    };
  }, [listRef]);

  if (!visible) return null;

  const scrollToTop = () => {
    cancelScrollToFacility();
    // Chrome Android では content-visibility: auto を含む長い一覧に対する behavior: 'smooth' が
    // 初回のみコンポジタ準備で大きく遅延することがあるため、即時スクロールで確実に応答させる。
    if (window.scrollY > 0) window.scrollTo(0, 0);
    const list = listRef.current;
    if (list && list.scrollTop > 0) list.scrollTo(0, 0);
    setVisible(false);
  };

  return (
    <button
      type="button"
      className={`${styles.button} ${mobileView === 'map' ? styles.aboveMapControls : ''}`}
      aria-label="先頭に戻る"
      title="先頭に戻る"
      onClick={scrollToTop}
    >
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    </button>
  );
}
