import { useEffect, useRef, useState } from 'react';
import * as v from 'valibot';
import { HomeSchema, type Home } from '../../schema';
import { geocode } from '../../lib/geo';

const HOME_KEY = 'find-daycare:home';

function loadHome(): Home | null {
  try {
    const raw = localStorage.getItem(HOME_KEY);
    const result = raw ? v.safeParse(HomeSchema, JSON.parse(raw)) : null;
    return result?.success ? result.output : null;
  } catch {
    return null;
  }
}

export type HomeChoice = 'search' | 'location';

export function useHome(wardNames: string[]) {
  const [home, setHome] = useState<Home | null>(loadHome);
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (home) localStorage.setItem(HOME_KEY, JSON.stringify(home));
    else localStorage.removeItem(HOME_KEY);
  }, [home]);

  function search(onHomeChosen: (source: HomeChoice) => void): void {
    if (!address.trim()) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setError(null);
    void geocode(address, wardNames, controller.signal)
      .then((found) => {
        setHome(found);
        onHomeChosen('search');
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (searchAbort.current === controller) setSearching(false);
      });
  }

  function locateMe(onHomeChosen: (source: HomeChoice) => void) {
    if (!navigator.geolocation) {
      setError('このブラウザは現在地の取得に対応していません。');
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' });
        onHomeChosen('location');
      },
      () => setError('現在地を取得できませんでした。住所を入力してください。'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return { home, address, setAddress, searching, error, search, locateMe, clearHome: () => setHome(null) };
}
