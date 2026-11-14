import type { CatalogObject } from './types';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function formatAlt(alt: number): string {
  const rounded = Math.round(alt);
  return `${rounded > 0 ? '+' : ''}${rounded}°`;
}

export function formatAz(az: number): string {
  const rounded = Math.round(((az % 360) + 360) % 360);
  const point = COMPASS[Math.round(rounded / 22.5) % 16];
  return `${rounded}° ${point}`;
}

export function formatRa(hours: number): string {
  const wrapped = ((hours % 24) + 24) % 24;
  const h = Math.floor(wrapped);
  const minutesFloat = (wrapped - h) * 60;
  const m = Math.floor(minutesFloat);
  const s = Math.round((minutesFloat - m) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function formatDec(deg: number): string {
  const sign = deg < 0 ? '−' : '+';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minutesFloat = (abs - d) * 60;
  const m = Math.floor(minutesFloat);
  const s = Math.round((minutesFloat - m) * 60);
  return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`;
}

function formatAxis(arcmin: number): string {
  if (arcmin >= 60) {
    const degrees = arcmin / 60;
    return `${degrees >= 10 ? degrees.toFixed(0) : degrees.toFixed(1)}°`;
  }
  return `${arcmin >= 10 ? arcmin.toFixed(0) : arcmin.toFixed(1)}′`;
}

export function formatSize(major: number | null, minor: number | null): string {
  if (major == null) return '—';
  if (minor == null || Math.abs(minor - major) < 0.05) return formatAxis(major);
  return `${formatAxis(major)} × ${formatAxis(minor)}`;
}

export function formatMag(mag: number | null): string {
  return mag == null ? '—' : mag.toFixed(1);
}

export type TypeGroup = 'galaxy' | 'cluster' | 'nebula' | 'planetary' | 'other';

export function typeGroup(type: string): TypeGroup {
  if (type === 'G' || type === 'GPair' || type === 'GTrpl' || type === 'GGroup') return 'galaxy';
  if (type === 'OCl' || type === 'GCl' || type === '*Ass') return 'cluster';
  if (type === 'PN') return 'planetary';
  if (type === 'HII' || type === 'Neb' || type === 'EmN' || type === 'RfN' || type === 'SNR' || type === 'DrkN' || type === 'Cl+N') {
    return 'nebula';
  }
  return 'other';
}

export function isMessier(id: string): boolean {
  return /^M\d+$/.test(id);
}

export function formatClock(date: Date, reference?: Date): string {
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!reference || date.toDateString() === reference.toDateString()) return time;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${day}, ${time}`;
}

/** A common name, omitting catalog numbers that repeat the object id. */
export function properName(id: string, name: string, alias = ''): string {
  const spaced = id.replace(/^(NGC|IC)(\d+)$/, '$1 $2');
  if (!name || name === id || name === spaced || name === alias) return '';
  return name;
}

export function formatStamp(date: Date): string {
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function localDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayInput(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function searchText(object: CatalogObject, constellationName: string): string {
  return `${object.id} ${object.name} ${object.alias} ${object.con} ${constellationName} ${object.typeLabel}`.toLowerCase();
}
