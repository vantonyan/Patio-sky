import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ConstellationFile } from '../src/lib/types';

describe('constellation bundle', () => {
  const file = JSON.parse(readFileSync('public/data/constellations.json', 'utf8')) as ConstellationFile;

  it('has all 88 IAU constellations, including both parts of Serpens', () => {
    expect(file.constellations).toHaveLength(88);
    const ids = new Set(file.constellations.map((item) => item.id));
    expect(ids.size).toBe(88);
    for (const id of ['Ori', 'UMa', 'UMi', 'Cru', 'Ser', 'And']) expect(ids.has(id)).toBe(true);
    const serpens = file.constellations.find((item) => item.id === 'Ser')!;
    expect(serpens.name).toBe('Serpens');
    expect(serpens.bounds.length).toBe(2);
    expect(serpens.lines.length).toBeGreaterThan(0);
    const orion = file.constellations.find((item) => item.id === 'Ori')!;
    expect(orion.name).toBe('Orion');
    expect(orion.ra).toBeGreaterThan(4);
    expect(orion.ra).toBeLessThan(7);
    expect(orion.dec).toBeGreaterThan(-15);
    expect(orion.dec).toBeLessThan(20);
  });
});
