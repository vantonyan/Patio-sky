export type CatalogObject = {
  id: string;
  name: string;
  alias: string;
  type: string;
  typeLabel: string;
  mag: number | null;
  major: number | null;
  minor: number | null;
  ra: number;
  dec: number;
  con: string;
};

export type CatalogFile = {
  generatedFrom: string;
  filter: string;
  messierCount: number;
  count: number;
  objects: CatalogObject[];
};

export type Constellation = {
  id: string;
  name: string;
  genitive: string;
  ra: number;
  dec: number;
  /** Stick-figure polylines. Each point is [RA hours, Dec degrees], J2000. */
  lines: number[][][];
  /** Boundary rings, same coordinate convention. */
  bounds: number[][][];
};

export type ConstellationFile = {
  source: string;
  count: number;
  constellations: Constellation[];
};

export type HorizonPoint = { az: number; alt: number };

export type HorizonFile = {
  name: string;
  sourceFile?: string;
  marginDeg: number;
  poorAzimuth: [number, number];
  poorLabel: string;
  points: HorizonPoint[];
};

export type SeedFile = {
  sourceFile?: string;
  columnRule?: string;
  note?: string;
  count: number;
  captured: string[];
};

export type LogStatus = 'captured' | 'observed';

export type LogEntry = {
  id: string;
  status: LogStatus;
  date: string;
  scope: string;
  notes: string;
  updatedAt: string;
  source: 'seed' | 'user' | 'import';
};

export type Settings = {
  lat: number;
  lon: number;
  locationLabel: string;
  patio: boolean;
  flatHorizon: number;
};

export type Visibility = {
  visible: boolean;
  required: number;
  poor: boolean;
  /** Patio was requested but no profile is bundled, so the flat horizon is used. */
  profileMissing: boolean;
};

export const SYLMAR = { lat: 34.3, lon: -118.45, label: 'Sylmar home' };

export const DEFAULT_SETTINGS: Settings = {
  lat: SYLMAR.lat,
  lon: SYLMAR.lon,
  locationLabel: SYLMAR.label,
  patio: true,
  flatHorizon: 15,
};

export const SCOPE_SUGGESTIONS = [
  'Celestron C8',
  'William Optics ZenithStar 73',
  'Sky-Watcher Quattro 150P',
  'SVBONY SV48P',
  'Canon EF 200mm f/2.8',
  'Canon EOS 6D',
  'Binoculars',
];

export const PATIO_MARGIN_DEG = 2;
export const POOR_AZIMUTH: [number, number] = [20, 60];
export const POOR_LABEL = 'poor: streetlights/tree gap';
