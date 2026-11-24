import { useCallback, useEffect, useState, type RefObject } from 'react';

function collapseOffsetOf(tabs: HTMLElement): number {
  let height = 0;
  for (let element = tabs.previousElementSibling; element; element = element.previousElementSibling) {
    height += element.getBoundingClientRect().height;
  }
  return Math.round(height);
}

export function useMobileHeaderScroll(appRef: RefObject<HTMLDivElement | null>, tabsRef: RefObject<HTMLElement | null>) {
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [canToggleHeader, setCanToggleHeader] = useState(false);

  useEffect(() => {
    const update = () => {
      const tabs = tabsRef.current;
      const app = appRef.current;
      if (!tabs || !app) return;
      const tabsHeight = Math.round(tabs.getBoundingClientRect().height);
      if (tabsHeight <= 0) {
        app.style.removeProperty('--mobile-bar-height');
        setCanToggleHeader(false);
        setHeaderCollapsed(false);
        return;
      }
      app.style.setProperty('--mobile-bar-height', `${tabsHeight}px`);
      const collapseOffset = collapseOffsetOf(tabs);
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const canToggle = collapseOffset > 0 && (maxScroll > 4 || window.scrollY > 4);
      const threshold = Math.min(collapseOffset, maxScroll) / 2;
      const collapsed = collapseOffset > 0 && window.scrollY > 4 && window.scrollY >= threshold;
      setCanToggleHeader(canToggle);
      setHeaderCollapsed(collapsed);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(document.documentElement);
    if (tabsRef.current) observer.observe(tabsRef.current);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [appRef, tabsRef]);

  const toggleHeader = useCallback(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const collapseOffset = collapseOffsetOf(tabs);
    if (collapseOffset <= 0) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: headerCollapsed ? 0 : collapseOffset,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }, [tabsRef, headerCollapsed]);

  return { headerCollapsed, canToggleHeader, toggleHeader };
}
