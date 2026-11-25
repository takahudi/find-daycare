import { useEffect, useRef, type RefObject } from 'react';

export function useMobileBarHeight(appRef: RefObject<HTMLDivElement | null>, tabsRef: RefObject<HTMLElement | null>) {
  const heightRef = useRef(-1);

  useEffect(() => {
    const measure = () => {
      const tabs = tabsRef.current;
      const app = appRef.current;
      if (!tabs || !app) return;
      const tabsHeight = Math.round(tabs.getBoundingClientRect().height);
      if (tabsHeight === heightRef.current) return;
      heightRef.current = tabsHeight;
      if (tabsHeight <= 0) {
        app.style.removeProperty('--mobile-bar-height');
      } else {
        app.style.setProperty('--mobile-bar-height', `${tabsHeight}px`);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (tabsRef.current) observer.observe(tabsRef.current);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [appRef, tabsRef]);
}
