import {
  EquatorFromVector,
  Horizon,
  Observer,
  Refraction,
  Rotation_EQJ_EQD,
  RotateVector,
  SiderealTime,
  Spherical,
  VectorFromSphere,
} from 'astronomy-engine';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const SIDEREAL_DAY_MS = 86164.0905 * 1000;

export function wrap24(hours: number): number {
  const value = hours % 24;
  return value < 0 ? value + 24 : value;
}

export function wrap360(degrees: number): number {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Greenwich apparent sidereal time plus east longitude, in hours. */
export function siderealHours(date: Date, lonEast: number): number {
  return wrap24(SiderealTime(date) + lonEast / 15);
}

/**
 * Geometric (unrefracted) altitude and azimuth.
 * Azimuth is degrees clockwise from north. Hour angle follows the usual sign:
 * positive west of the meridian.
 */
export function geometricAltAz(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lstHours: number,
): { alt: number; az: number } {
  let ha = (lstHours - raHours) * 15;
  ha = ((ha + 540) % 360) - 180;
  const haR = ha * DEG;
  const dec = decDeg * DEG;
  const lat = latDeg * DEG;
  const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(haR);
  const alt = Math.asin(Math.min(1, Math.max(-1, sinAlt)));
  const cosAlt = Math.cos(alt);
  const cosLat = Math.cos(lat);
  let az: number;
  if (cosAlt < 1e-8 || Math.abs(cosLat) < 1e-8) {
    az = decDeg >= latDeg ? 0 : Math.PI;
  } else {
    const cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / (cosAlt * cosLat);
    az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
    if (Math.sin(haR) > 0) az = 2 * Math.PI - az;
  }
  return { alt: alt * RAD, az: wrap360(az * RAD) };
}

/** J2000 catalog coordinates to the mean equator of date. */
export function precessToDate(raHours: number, decDeg: number, date: Date): { ra: number; dec: number } {
  const vector = VectorFromSphere(new Spherical(decDeg, wrap360(raHours * 15), 1), date);
  const ofDate = RotateVector(Rotation_EQJ_EQD(date), vector);
  const equatorial = EquatorFromVector(ofDate);
  return { ra: wrap24(equatorial.ra), dec: equatorial.dec };
}

/**
 * Apparent altitude and azimuth for a J2000 RA/Dec.
 * Precesses to the date, then adds astronomy-engine's normal refraction.
 * Agrees with `Horizon` called on the precessed coordinates.
 */
export function apparentAltAz(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonEast: number,
  date: Date,
): { alt: number; az: number } {
  const equatorial = precessToDate(raHours, decDeg, date);
  const geometric = geometricAltAz(equatorial.ra, equatorial.dec, latDeg, siderealHours(date, lonEast));
  return { alt: geometric.alt + Refraction('normal', geometric.alt), az: geometric.az };
}

/** Direct astronomy-engine call, used by tests and as the reference implementation. */
export function engineAltAz(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonEast: number,
  date: Date,
  refraction: 'normal' | null,
): { alt: number; az: number } {
  const horizontal = Horizon(date, new Observer(latDeg, lonEast, 0), raHours, decDeg, refraction ?? undefined);
  return { alt: horizontal.altitude, az: horizontal.azimuth };
}

function timeOfLst(targetLst: number, from: Date, lonEast: number): Date {
  const now = siderealHours(from, lonEast);
  const delta = wrap24(targetLst - now);
  let guess = new Date(from.getTime() + (delta * SIDEREAL_DAY_MS) / 24);
  for (let i = 0; i < 4; i += 1) {
    const current = siderealHours(guess, lonEast);
    let error = targetLst - current;
    if (error > 12) error -= 24;
    if (error < -12) error += 24;
    guess = new Date(guess.getTime() + (error * SIDEREAL_DAY_MS) / 24);
  }
  return guess;
}

export type SkyEvents = {
  transit: Date;
  transitAlt: number;
  rise: Date | null;
  set: Date | null;
  alwaysUp: boolean;
  neverUp: boolean;
};

/**
 * Next rise, transit, and set of a fixed J2000 object.
 * `minAltitude` is the altitude the object must exceed. It may depend on azimuth,
 * which is how the patio profile is applied (horizon altitude plus 2°).
 */
export function riseTransitSet(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonEast: number,
  from: Date,
  minAltitude: (azimuth: number) => number,
): SkyEvents {
  const equatorial = precessToDate(raHours, decDeg, from);
  const at = (date: Date) => {
    const geometric = geometricAltAz(equatorial.ra, equatorial.dec, latDeg, siderealHours(date, lonEast));
    const alt = geometric.alt + Refraction('normal', geometric.alt);
    return { alt, az: geometric.az, clear: alt > minAltitude(geometric.az) };
  };

  const transit = timeOfLst(equatorial.ra, from, lonEast);
  const culmination = at(transit);
  const start = from.getTime();
  const end = start + SIDEREAL_DAY_MS * 1.05;
  const step = 2 * 60 * 1000;
  let prevTime = start;
  let prev = at(from);
  let rise: Date | null = null;
  let set: Date | null = null;

  const cross = (t0: number, t1: number, rising: boolean) => {
    let lo = t0;
    let hi = t1;
    for (let i = 0; i < 18; i += 1) {
      const mid = (lo + hi) / 2;
      const clear = at(new Date(mid)).clear;
      if (clear === rising) hi = mid;
      else lo = mid;
    }
    return new Date((lo + hi) / 2);
  };

  for (let time = start + step; time <= end && (rise === null || set === null); time += step) {
    const current = at(new Date(time));
    if (!prev.clear && current.clear && rise === null) rise = cross(prevTime, time, true);
    else if (prev.clear && !current.clear && set === null) set = cross(prevTime, time, false);
    prev = current;
    prevTime = time;
  }

  const alwaysUp = rise === null && set === null && at(from).clear;
  const neverUp = rise === null && set === null && !at(from).clear;
  return { transit, transitAlt: culmination.alt, rise, set, alwaysUp, neverUp };
}

export function nearHome(lat: number, lon: number, km = 8): boolean {
  const dLat = lat - 34.3;
  const dLon = (lon - -118.45) * Math.cos(34.3 * DEG);
  return Math.hypot(dLat, dLon) * 111 <= km;
}
