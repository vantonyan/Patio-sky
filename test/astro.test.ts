import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Constellation, Horizon, Observer } from 'astronomy-engine';
import { apparentAltAz, engineAltAz, geometricAltAz, precessToDate, riseTransitSet, siderealHours } from '../src/lib/astro';
import type { CatalogFile } from '../src/lib/types';

const WHEN = new Date(Date.UTC(2026, 10, 15, 8, 0, 0));
const LAT = 34.3;
const LON = -118.45;
const M42 = { ra: 5.58791, dec: -5.38967 };

function azDelta(a: number, b: number): number {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}

describe('altitude and azimuth', () => {
  it('matches astronomy-engine geometrically, before precession', () => {
    const lst = siderealHours(WHEN, LON);
    const mine = geometricAltAz(M42.ra, M42.dec, LAT, lst);
    const engine = engineAltAz(M42.ra, M42.dec, LAT, LON, WHEN, null);
    expect(Math.abs(mine.alt - engine.alt)).toBeLessThan(0.02);
    expect(azDelta(mine.az, engine.az)).toBeLessThan(0.02);
  });

  it('matches refracted Horizon after precession to the date', () => {
    const equatorial = precessToDate(M42.ra, M42.dec, WHEN);
    const mine = apparentAltAz(M42.ra, M42.dec, LAT, LON, WHEN);
    const engine = Horizon(WHEN, new Observer(LAT, LON, 0), equatorial.ra, equatorial.dec, 'normal');
    expect(Math.abs(mine.alt - engine.altitude)).toBeLessThan(0.03);
    expect(azDelta(mine.az, engine.azimuth)).toBeLessThan(0.03);
    // Spot values for Sylmar at 2026-11-15 00:00 PST. M42 is high in the southeast.
    expect(mine.alt).toBeCloseTo(42.26, 1);
    expect(mine.az).toBeCloseTo(140.58, 1);
  });

  it('puts a star on the meridian at the expected altitude and due south or north', () => {
    const lst = siderealHours(WHEN, LON);
    const south = geometricAltAz(lst, -20, LAT, lst);
    expect(south.alt).toBeCloseTo(35.7, 1);
    expect(azDelta(south.az, 180)).toBeLessThan(0.5);

    const zenith = geometricAltAz(lst, LAT, LAT, lst);
    expect(zenith.alt).toBeGreaterThan(89.9);

    const polaris = geometricAltAz(2.5, 89.26, LAT, lst);
    expect(polaris.alt).toBeGreaterThan(33.4);
    expect(polaris.alt).toBeLessThan(35.2);
  });

  it('predicts rise against a flat horizon within a few minutes of the altitude crossing', () => {
    const events = riseTransitSet(M42.ra, M42.dec, LAT, LON, WHEN, () => 15);
    expect(events.rise).not.toBeNull();
    expect(events.set).not.toBeNull();
    const rise = events.rise!;
    const atRise = apparentAltAz(M42.ra, M42.dec, LAT, LON, rise);
    expect(Math.abs(atRise.alt - 15)).toBeLessThan(0.2);
    const before = apparentAltAz(M42.ra, M42.dec, LAT, LON, new Date(rise.getTime() - 4 * 60 * 1000));
    expect(before.alt).toBeLessThan(15);
  });

  it('treats a high northern object as circumpolar above a 15° horizon', () => {
    const events = riseTransitSet(11, 77, LAT, LON, WHEN, () => 15);
    expect(events.alwaysUp).toBe(true);
    expect(events.rise).toBeNull();
    expect(events.set).toBeNull();
    expect(events.transitAlt).toBeGreaterThan(40);
  });
});

describe('catalog coordinates', () => {
  const catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf8')) as CatalogFile;

  it('contains every Messier object once', () => {
    const ids = catalog.objects.filter((object) => /^M\d+$/.test(object.id)).map((object) => object.id);
    expect(new Set(ids).size).toBe(110);
    expect(ids).toContain('M1');
    expect(ids).toContain('M102');
    expect(ids).toContain('M110');
  });

  it('places familiar objects in the IAU constellation astronomy-engine reports', () => {
    for (const [id, symbol] of [
      ['M42', 'Ori'],
      ['M31', 'And'],
      ['M45', 'Tau'],
      ['M13', 'Her'],
      ['M57', 'Lyr'],
      ['M8', 'Sgr'],
      ['M51', 'CVn'],
      ['M102', 'Dra'],
    ] as const) {
      const object = catalog.objects.find((item) => item.id === id)!;
      expect(object.con).toBe(symbol);
      expect(Constellation(object.ra, object.dec).symbol).toBe(symbol);
    }
    const orion = catalog.objects.find((item) => item.id === 'M42')!;
    expect(orion.ra).toBeCloseTo(5.588, 2);
    expect(orion.dec).toBeCloseTo(-5.39, 1);
    expect(orion.name).toMatch(/Orion/);
  });
});
