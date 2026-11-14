import type { HorizonPoint, Settings, Visibility } from './types';
import { PATIO_MARGIN_DEG, POOR_AZIMUTH } from './types';

export function parseHorizonText(text: string): HorizonPoint[] {
  const points: HorizonPoint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
    const parts = line.replace(/,/g, ' ').split(/\s+/);
    if (parts.length < 2) continue;
    const az = Number(parts[0]);
    const alt = Number(parts[1]);
    if (!Number.isFinite(az) || !Number.isFinite(alt)) continue;
    if (Math.abs(alt) > 90 || Math.abs(az) > 3600) continue;
    points.push({ az: ((az % 360) + 360) % 360, alt });
  }
  points.sort((a, b) => a.az - b.az);
  const deduped: HorizonPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last.az - point.az) < 1e-4) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }
  return deduped;
}

/** Linear interpolation in azimuth, wrapping across 0°/360°. */
export function interpolateHorizon(points: HorizonPoint[], azimuth: number): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0].alt;
  const az = ((azimuth % 360) + 360) % 360;
  let next = 0;
  while (next < points.length && points[next].az < az) next += 1;
  const i1 = next % points.length;
  const i0 = (next - 1 + points.length) % points.length;
  let az0 = points[i0].az;
  let az1 = points[i1].az;
  let sample = az;
  if (i0 === i1) return points[i0].alt;
  if (az1 <= az0) {
    az1 += 360;
    if (sample < az0) sample += 360;
  }
  const span = az1 - az0 || 1;
  const t = (sample - az0) / span;
  return points[i0].alt + t * (points[i1].alt - points[i0].alt);
}

export function inPoorSector(azimuth: number, sector: [number, number] = POOR_AZIMUTH): boolean {
  const az = ((azimuth % 360) + 360) % 360;
  const [start, end] = sector;
  if (start <= end) return az >= start && az <= end;
  return az >= start || az <= end;
}

export function judgeVisibility(
  alt: number,
  az: number,
  settings: Pick<Settings, 'patio' | 'flatHorizon'>,
  profile: HorizonPoint[] | null,
): Visibility {
  const profileMissing = settings.patio && (!profile || profile.length < 2);
  const usePatio = settings.patio && !profileMissing && profile !== null;
  const required = usePatio ? interpolateHorizon(profile, az) + PATIO_MARGIN_DEG : settings.flatHorizon;
  return {
    visible: alt > required,
    required,
    poor: usePatio && inPoorSector(az),
    profileMissing,
  };
}
