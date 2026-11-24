import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

function collapseOffsetOf(tabs: HTMLElement): number {
  let height = 0;
  for (let element = tabs.previousElementSibling; element; element = element.previousElementSibling) {
    height += element.getBoundingClientRect().height;
  }
  return Math.round(height);
}

export function useMobileHeaderScroll(
  appRef: RefObject<HTMLDivElement | null>,
  tabsRef: RefObject<HTMLElement | null>,
  mobileView: 'list' | 'map',
  itemCount: number,
) {
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [canToggleHeader, setCanToggleHeader] = useState(false);
  const metricsRef = useRef({ collapseOffset: 0, maxScroll: 0, tabsHeight: 0 });
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const syncScrollState = () => {
      const { collapseOffset, maxScroll, tabsHeight } = metricsRef.current;
      if (tabsHeight <= 0) {
        setCanToggleHeader(false);
        setHeaderCollapsed(false);
        return;
      }
      const scrollY = window.scrollY;
      const canToggle = collapseOffset > 0 && (maxScroll > 4 || scrollY > 4);
      const threshold = Math.min(collapseOffset, maxScroll) / 2;
      const collapsed = collapseOffset > 0 && scrollY > 4 && scrollY >= threshold;
      setCanToggleHeader(canToggle);
      setHeaderCollapsed(collapsed);
    };

    const measure = () => {
      const tabs = tabsRef.current;
      const app = appRef.current;
      if (!tabs || !app) return;
      const tabsHeight = Math.round(tabs.getBoundingClientRect().height);
      if (tabsHeight !== metricsRef.current.tabsHeight) {
        if (tabsHeight <= 0) {
          app.style.removeProperty('--mobile-bar-height');
        } else {
          app.style.setProperty('--mobile-bar-height', `${tabsHeight}px`);
        }
      }
      const collapseOffset = tabsHeight > 0 ? collapseOffsetOf(tabs) : 0;
      const maxScroll = tabsHeight > 0 ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight) : 0;
      metricsRef.current = { collapseOffset, maxScroll, tabsHeight };
      syncScrollState();
    };

    measureRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    const tabs = tabsRef.current;
    if (tabs) {
      observer.observe(tabs);
      for (let element = tabs.previousElementSibling; element; element = element.previousElementSibling) {
        observer.observe(element);
      }
    }
    window.addEventListener('scroll', syncScrollState, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', syncScrollState);
      window.removeEventListener('resize', measure);
    };
  }, [appRef, tabsRef]);

  useEffect(() => {
    if (mobileView === 'map' || itemCount >= 0) {
      measureRef.current();
    }
  }, [mobileView, itemCount]);

  const toggleHeader = useCallback(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const collapseOffset = collapseOffsetOf(tabs);
    if (collapseOffset <= 0) return;
    const target = headerCollapsed ? 0 : collapseOffset;
    const distance = Math.abs(window.scrollY - target);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: target,
      behavior: reducedMotion || distance > collapseOffset * 2 ? 'auto' : 'smooth',
    });
  }, [tabsRef, headerCollapsed]);

  return { headerCollapsed, canToggleHeader, toggleHeader };
}
