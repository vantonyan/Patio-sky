import { describe, expect, it } from 'vitest';
import { interpolateHorizon, judgeVisibility, parseHorizonText } from '../src/lib/horizon';
import type { HorizonPoint } from '../src/lib/types';

const PROFILE: HorizonPoint[] = [
  { az: 0, alt: 10 },
  { az: 90, alt: 20 },
  { az: 180, alt: 40 },
  { az: 270, alt: 30 },
];

describe('patio horizon', () => {
  it('parses comments, headers, and azimuth/altitude pairs', () => {
    const text = `# Foothill patio
azimuth altitude
0 12.5
90, 18
180 40.2
not a row
`;
    expect(parseHorizonText(text)).toEqual([
      { az: 0, alt: 12.5 },
      { az: 90, alt: 18 },
      { az: 180, alt: 40.2 },
    ]);
  });

  it('interpolates across a segment and across north', () => {
    expect(interpolateHorizon(PROFILE, 45)).toBeCloseTo(15, 5);
    expect(interpolateHorizon(PROFILE, 315)).toBeCloseTo(20, 5);
    expect(interpolateHorizon(PROFILE, 0)).toBeCloseTo(10, 5);
    expect(interpolateHorizon(PROFILE, 360)).toBeCloseTo(10, 5);
  });

  it('requires the patio altitude plus 2 degrees, and flags the streetlight sector', () => {
    const clear = judgeVisibility(18, 45, { patio: true, flatHorizon: 15 }, PROFILE);
    expect(clear.required).toBeCloseTo(17, 5);
    expect(clear.visible).toBe(true);
    expect(clear.poor).toBe(true);

    const blocked = judgeVisibility(16.9, 45, { patio: true, flatHorizon: 15 }, PROFILE);
    expect(blocked.visible).toBe(false);

    const south = judgeVisibility(50, 180, { patio: true, flatHorizon: 15 }, PROFILE);
    expect(south.required).toBeCloseTo(42, 5);
    expect(south.poor).toBe(false);
    expect(south.visible).toBe(true);
  });

  it('uses the flat horizon when the patio toggle is off', () => {
    const away = judgeVisibility(16, 30, { patio: false, flatHorizon: 15 }, PROFILE);
    expect(away.required).toBe(15);
    expect(away.visible).toBe(true);
    expect(away.poor).toBe(false);

    const low = judgeVisibility(15, 30, { patio: false, flatHorizon: 15 }, PROFILE);
    expect(low.visible).toBe(false);
  });
});
