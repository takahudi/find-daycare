import type { Ref } from 'react';
import { useTheme } from '../../app/theme';
import { LICENSING_LABELS } from '../../lib/facility-labels';
import { facilityFace, HOME_FACE } from './pin-face';
import { PinSwatch } from './PinSwatch';
import styles from './MapLegend.module.css';

const ENTRIES = [
  { face: facilityFace({ licensing: 'licensed' }, 2, false), label: '空きあり（人数）' },
  { face: facilityFace({ licensing: 'licensed' }, 0, false), label: '空きなし' },
  { face: facilityFace({ licensing: 'unlicensed' }, 1, false), label: LICENSING_LABELS.unlicensed },
] as const;

export function MapLegend({ hasHome: home, ref }: { hasHome: boolean; ref?: Ref<HTMLDivElement> }) {
  const { theme } = useTheme();
  return (
    <div className={styles.legendTrack}>
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- 凡例はフォームや見出しの集合ではないため、ARIA でグループ化する。 */}
      <div ref={ref} className={styles.legend} role="group" aria-label="地図の凡例">
        {ENTRIES.map(({ face, label }) => (
          <span key={label}>
            <PinSwatch face={face} theme={theme} /> {label}
          </span>
        ))}
        {home && (
          <span>
            <PinSwatch face={HOME_FACE} theme={theme} /> 自宅
          </span>
        )}
      </div>
    </div>
  );
}
