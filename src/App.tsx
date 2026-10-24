import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import rawData from './data/facilities.json';
import type { Category, Dataset, Facility, Home } from './types';
import { FacilityCard } from './components/FacilityCard';
import { MapView } from './components/MapView';
import { distanceMeters, geocode } from './lib/geo';
import { AGE_LABELS, AGES, acceptsAny, vacancyCount } from './lib/vacancy';

const data = rawData as Dataset;
const WARD_NAMES = data.wards.map((w) => w.name);
// 区が増えると区名を並べきれないので、5区以上は区の数で表す（区名は見出しのツールチップに出す）
const TITLE =
  WARD_NAMES.length >= 24
    ? '大阪市'
    : WARD_NAMES.length >= 5
      ? `大阪市 ${WARD_NAMES.length}区`
      : `大阪市 ${WARD_NAMES.join('・')}`;
// 区ごとの空き情報の時点が揃っていれば1つにまとめて表示する
const asOfLabels = [...new Set(data.wards.map((w) => `${w.vacancyAsOf}（${w.vacancyFor}）`))];
// 企業主導型の時点は区ごとにずれることがあるので、最も多い時点を基本にし、違う区だけ区名付きで添える
const kigyoAsOfText = (() => {
  const byLabel = new Map<string, string[]>();
  for (const w of data.wards) {
    if (w.kigyoVacancyAsOf) byLabel.set(w.kigyoVacancyAsOf, [...(byLabel.get(w.kigyoVacancyAsOf) ?? []), w.name]);
  }
  const [main, ...others] = [...byLabel].sort((a, b) => b[1].length - a[1].length);
  if (!main) return null;
  const exceptions = others.map(([label, names]) => `${names.join('・')}は${label}`).join('、');
  return exceptions ? `${main[0]}（${exceptions}）` : main[0];
})();

type SortKey = 'distance' | 'vacancy' | 'name';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'nursery', label: '保育所' },
  { key: 'kodomoen', label: '認定こども園' },
  { key: 'community', label: '地域型保育（0〜2歳）' },
  { key: 'kigyo', label: '企業主導型（認可外）' },
];

const HOME_KEY = 'find-daycare:home';

function loadHome(): Home | null {
  try {
    const raw = localStorage.getItem(HOME_KEY);
    return raw ? (JSON.parse(raw) as Home) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [ages, setAges] = useState<number[]>([]);
  const [wardIds, setWardIds] = useState<string[]>(data.wards.map((w) => w.id));
  const [categories, setCategories] = useState<Category[]>(CATEGORIES.map((c) => c.key));
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [home, setHome] = useState<Home | null>(loadHome);
  const [sort, setSort] = useState<SortKey>(home ? 'distance' : 'vacancy');
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const searchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (home) localStorage.setItem(HOME_KEY, JSON.stringify(home));
    else localStorage.removeItem(HOME_KEY);
  }, [home]);

  const distanceOf = useMemo(() => {
    const cache = new Map(data.facilities.map((f) => [f.id, home ? distanceMeters(home, f) : null]));
    return (f: Facility) => cache.get(f.id) ?? null;
  }, [home]);
  const vacancyOf = useMemo(() => (f: Facility) => vacancyCount(f, ages), [ages]);

  const visible = useMemo(() => {
    const list = data.facilities.filter(
      (f) =>
        wardIds.includes(f.ward) && categories.includes(f.category) && acceptsAny(f, ages) && (!onlyOpen || vacancyOf(f) > 0),
    );
    // 企業主導型はふりがなの一次情報がないので施設名で並べる
    const byName = (a: Facility, b: Facility) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja');
    const comparators: Record<SortKey, (a: Facility, b: Facility) => number> = {
      distance: (a, b) => (distanceOf(a) ?? 0) - (distanceOf(b) ?? 0) || byName(a, b),
      vacancy: (a, b) => vacancyOf(b) - vacancyOf(a) || byName(a, b),
      name: byName,
    };
    return list.sort(comparators[sort]);
  }, [wardIds, categories, ages, onlyOpen, sort, distanceOf, vacancyOf]);

  const openCount = visible.filter((f) => vacancyOf(f) > 0).length;

  const select = (id: string, from: 'list' | 'map') => {
    setSelectedId(id);
    if (from === 'map') cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!address.trim()) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setError(null);
    try {
      const found = await geocode(address, WARD_NAMES, controller.signal);
      setHome(found);
      setSort('distance');
      setSelectedId(null);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (searchAbort.current === controller) setSearching(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setError('このブラウザは現在地の取得に対応していません。');
      return;
    }
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' });
        setSort('distance');
      },
      () => setError('現在地を取得できませんでした。住所を入力してください。'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className={`app app--${mobileView}`}>
      <header className="topbar">
        <div className="topbar__title">
          <h1 title={`対象: ${WARD_NAMES.join('・')}`}>
            {TITLE}の保育施設 <span>空き状況マップ</span>
          </h1>
          <p className="topbar__asof">
            空き情報：
            {asOfLabels.length === 1 ? (
              <strong>{asOfLabels[0]}</strong>
            ) : (
              data.wards.map((w) => (
                <span key={w.id}>
                  {w.name} <strong>{w.vacancyAsOf}</strong>（{w.vacancyFor}）{' '}
                </span>
              ))
            )}
            {kigyoAsOfText && <>・企業主導型（地域枠）は{kigyoAsOfText}</>}・出典 大阪市・各区役所
          </p>
        </div>

        <form className="search" onSubmit={onSearch}>
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
          <button type="button" className="ghost" onClick={locateMe}>
            現在地
          </button>
        </form>
        {(home || error) && (
          <p className={`search__status${error ? ' search__status--error' : ''}`} role="status">
            {error ?? (
              <>
                🏠 <strong>{home!.label}</strong> からの直線距離で表示中
                <button type="button" className="link" onClick={() => setHome(null)}>
                  解除
                </button>
              </>
            )}
          </p>
        )}
      </header>

      <section className="filters" aria-label="絞り込み">
        {data.wards.length > 1 && (
          <div className="filters__group">
            <span className="filters__label">区</span>
            {data.wards.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`chip${wardIds.includes(w.id) ? ' chip--on' : ''}`}
                aria-pressed={wardIds.includes(w.id)}
                onClick={() => setWardIds((cur) => toggle(cur, w.id))}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}
        <div className="filters__group">
          <span className="filters__label">クラス年齢</span>
          {AGES.map((a) => (
            <button
              key={a}
              type="button"
              className={`chip${ages.includes(a) ? ' chip--on' : ''}`}
              aria-pressed={ages.includes(a)}
              onClick={() => setAges((cur) => toggle(cur, a).sort())}
            >
              {AGE_LABELS[a]}
            </button>
          ))}
        </div>
        <div className="filters__group">
          <span className="filters__label">種別</span>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`chip chip--${c.key}${categories.includes(c.key) ? ' chip--on' : ''}`}
              aria-pressed={categories.includes(c.key)}
              onClick={() => setCategories((cur) => toggle(cur, c.key))}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="filters__group">
          <label className="toggle">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            空きがある施設のみ
          </label>
          <label className="sort">
            並び順
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="distance" disabled={!home}>
                自宅から近い順{home ? '' : '（住所を入力）'}
              </option>
              <option value="vacancy">空きが多い順</option>
              <option value="name">名前順</option>
            </select>
          </label>
        </div>
      </section>

      <nav className="mobile-tabs" aria-label="表示切替">
        <button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>
          リスト
        </button>
        <button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>
          地図
        </button>
      </nav>

      <main className="layout">
        <section className="list" aria-label="施設一覧">
          <p className="list__count">
            {visible.length}件中 <strong>{openCount}件</strong>
            に空きあり{ages.length > 0 && `（${ages.map((a) => AGE_LABELS[a]).join('・')}クラス）`}
          </p>
          <div className="cards">
            {visible.map((f, i) => (
              <FacilityCard
                key={f.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(f.id, el);
                  else cardRefs.current.delete(f.id);
                }}
                facility={f}
                rank={sort === 'distance' && home ? i + 1 : null}
                distance={distanceOf(f)}
                highlightAges={ages}
                selected={f.id === selectedId}
                onSelect={() => select(f.id, 'list')}
                onShowOnMap={() => {
                  select(f.id, 'list');
                  setMobileView('map');
                }}
              />
            ))}
            {visible.length === 0 && <p className="empty">条件に合う施設がありません。絞り込みを変更してください。</p>}
          </div>
          <Sources />
        </section>

        <section className="map-pane" aria-label="地図">
          <MapView
            facilities={visible}
            vacancyOf={vacancyOf}
            distanceOf={distanceOf}
            home={home}
            selectedId={selectedId}
            onSelect={(id) => select(id, 'map')}
          />
          <div className="legend" aria-hidden>
            <span>
              <i className="pin pin--open">2</i> 空きあり（人数）
            </span>
            <span>
              <i className="pin pin--full">×</i> 空きなし
            </span>
            <span>
              <i className="pin pin--open pin--unlicensed">1</i> 企業主導型（認可外）
            </span>
            {home && (
              <span>
                <i className="pin pin--home">家</i> 自宅
              </span>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Sources() {
  return (
    <footer className="sources">
      <p>
        空き人数は{asOfLabels.join('／')}の情報です。日々変動するため、利用申込みの前に必ず各区の保健福祉センター（
        {WARD_NAMES.map((n) => `${n}役所`).join('・')}）または各施設へご確認ください。距離は直線距離です。
      </p>
      <p>
        企業主導型保育事業所は認可外保育施設です。利用は施設と保護者の直接契約で、区役所の利用調整の対象外です。利用料・対象年齢・利用条件は施設ごとに異なるため、見学のうえ施設へ直接お問い合わせください（空き人数は地域枠の数）。
      </p>
      <ul>
        {[...data.wards.flatMap((w) => w.sources), ...data.commonSources].map((s) => (
          <li key={s.url + s.label}>
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.label}
            </a>
          </li>
        ))}
        <li>
          住所検索：
          <a href="https://msearch.gsi.go.jp/address-search/AddressSearch" target="_blank" rel="noreferrer">
            国土地理院 住所検索API
          </a>
          ／ 地図：国土地理院 地理院タイル（淡色地図）
        </li>
      </ul>
    </footer>
  );
}
