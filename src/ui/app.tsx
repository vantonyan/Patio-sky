import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CatalogFile, CatalogObject, ConstellationFile, HorizonFile, LogEntry, SeedFile, Settings } from '../lib/types';
import { DEFAULT_SETTINGS, SCOPE_SUGGESTIONS, SYLMAR } from '../lib/types';
import { apparentAltAz, nearHome, riseTransitSet, type SkyEvents } from '../lib/astro';
import { judgeVisibility } from '../lib/horizon';
import {
  canonicalId,
  chooseCaptured,
  displayId,
  entriesFromJson,
  entriesFromLogRows,
  isLogCsv,
  logToCsv,
  logToJson,
  parseCsv,
  readXlsxRows,
  spreadsheetEntries,
} from '../lib/spreadsheet';
import {
  formatAlt,
  formatAz,
  formatClock,
  formatDec,
  formatMag,
  formatRa,
  formatSize,
  isMessier,
  properName,
  localDateInput,
  todayInput,
  typeGroup,
  type TypeGroup,
} from '../lib/format';
import { loadLog, loadSettings, replaceLog, saveSettings, seedEntries } from '../lib/storage';
import { SkyChart, type ChartConstellation } from './sky-chart';

type Bundle = {
  catalog: CatalogFile;
  skies: ConstellationFile;
  horizon: HorizonFile | null;
  seed: SeedFile | null;
};

type Route =
  | { name: 'sky' | 'tonight' | 'catalog' | 'log' | 'settings' }
  | { name: 'constellation'; id: string }
  | { name: 'object'; id: string };

type Placed = {
  object: CatalogObject;
  alt: number;
  az: number;
  visible: boolean;
  required: number;
  poor: boolean;
  profileMissing: boolean;
};

function parseRoute(hash: string): Route {
  const path = decodeURIComponent(hash.replace(/^#/, ''));
  const [head, rest] = path.split('/');
  if (head === 'const' && rest) return { name: 'constellation', id: rest };
  if (head === 'object' && rest) return { name: 'object', id: rest };
  if (head === 'tonight' || head === 'catalog' || head === 'log' || head === 'settings') return { name: head };
  return { name: 'sky' };
}

function go(hash: string) {
  location.hash = hash;
}

export function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hash, setHash] = useState(() => location.hash || '#sky');
  const [offsetMin, setOffsetMin] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [online, setOnline] = useState(() => navigator.onLine);
  const [upOnly, setUpOnly] = useState(true);
  const [showBounds, setShowBounds] = useState(false);
  const [sort, setSort] = useState<'alt' | 'mag' | 'size'>('alt');
  const [group, setGroup] = useState<'all' | TypeGroup>('all');
  const [magLimit, setMagLimit] = useState(12);
  const [minAlt, setMinAlt] = useState(0);
  const [messierOnly, setMessierOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [catalogLimit, setCatalogLimit] = useState(80);
  const [gpsNote, setGpsNote] = useState('');
  const [importNote, setImportNote] = useState('');
  const [replaceImport, setReplaceImport] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const route = parseRoute(hash);

  useEffect(() => {
    const onHash = () => setHash(location.hash || '#sky');
    window.addEventListener('hashchange', onHash);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (offsetMin !== 0) return;
    const id = window.setInterval(() => setTick(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [offsetMin]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const base = import.meta.env.BASE_URL;
        const load = async <T,>(path: string): Promise<T | null> => {
          try {
            const response = await fetch(`${base}${path}`);
            if (!response.ok) return null;
            const text = await response.text();
            const trimmed = text.trim();
            if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
            return JSON.parse(trimmed) as T;
          } catch {
            return null;
          }
        };
        const catalog = await load<CatalogFile>('data/catalog.json');
        const skies = await load<ConstellationFile>('data/constellations.json');
        if (!catalog || !skies) throw new Error('missing catalogs');
        const horizon = await load<HorizonFile>('data/horizon.json');
        const seed = await load<SeedFile>('data/messier-seed.json');
        const [loadedLog, loadedSettings] = await Promise.all([
          loadLog(seed?.captured ?? null),
          loadSettings(),
        ]);
        if (cancel) return;
        setBundle({ catalog, skies, horizon, seed });
        setEntries(loadedLog);
        setSettings(loadedSettings);
      } catch {
        if (!cancel) {
          setError('The catalogs did not load. Connect once so Patio Sky can store them, then open it again.');
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const when = new Date(tick + offsetMin * 60000);
  const minute = Math.floor(when.getTime() / 60000);
  const log = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const profile = bundle?.horizon?.points ?? null;
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const con of bundle?.skies.constellations ?? []) map.set(con.id, con.name);
    return map;
  }, [bundle]);
  const byCon = useMemo(() => {
    const map = new Map<string, CatalogObject[]>();
    for (const object of bundle?.catalog.objects ?? []) {
      const list = map.get(object.con) ?? [];
      list.push(object);
      map.set(object.con, list);
    }
    return map;
  }, [bundle]);

  const placed = useMemo(() => {
    if (!bundle) return [] as Placed[];
    const date = new Date(minute * 60000);
    return bundle.catalog.objects.map((object) => {
      const horizontal = apparentAltAz(object.ra, object.dec, settings.lat, settings.lon, date);
      const visibility = judgeVisibility(horizontal.alt, horizontal.az, settings, profile);
      return { object, alt: horizontal.alt, az: horizontal.az, ...visibility };
    });
  }, [bundle, minute, settings.lat, settings.lon, settings.patio, settings.flatHorizon, profile]);

  const placedById = useMemo(() => new Map(placed.map((item) => [item.object.id, item])), [placed]);

  const constViews = useMemo(() => {
    if (!bundle) return [] as ChartConstellation[];
    const date = new Date(minute * 60000);
    const projectPoint = (ra: number, dec: number) => apparentAltAz(ra, dec, settings.lat, settings.lon, date);
    return bundle.skies.constellations
      .map((con) => {
        const center = projectPoint(con.ra, con.dec);
        const centerVis = judgeVisibility(center.alt, center.az, settings, profile);
        let any = centerVis.visible;
        if (!any) {
          for (const line of con.lines) {
            for (const [ra, dec] of line) {
              const point = projectPoint(ra, dec);
              if (judgeVisibility(point.alt, point.az, settings, profile).visible) {
                any = true;
                break;
              }
            }
            if (any) break;
          }
        }
        const state = centerVis.visible ? 'up' : any ? 'partial' : 'down';
        return { con, alt: center.alt, az: center.az, state } as ChartConstellation;
      })
      .sort((a, b) => {
        const rank = (state: ChartConstellation['state']) => (state === 'up' ? 0 : state === 'partial' ? 1 : 2);
        return rank(a.state) - rank(b.state) || b.alt - a.alt;
      });
  }, [bundle, minute, settings.lat, settings.lon, settings.patio, settings.flatHorizon, profile]);

  const project = (ra: number, dec: number) =>
    apparentAltAz(ra, dec, settings.lat, settings.lon, new Date(minute * 60000));

  async function commit(next: LogEntry[]) {
    setEntries(next);
    await replaceLog(next);
  }

  async function updateSettings(patch: Partial<Settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  }

  function saveEntry(id: string, status: LogEntry['status'], draft: { date: string; scope: string; notes: string }) {
    const next = new Map(log);
    next.set(id, {
      id,
      status,
      date: draft.date || todayInput(when),
      scope: draft.scope.trim(),
      notes: draft.notes.trim(),
      updatedAt: new Date().toISOString(),
      source: 'user',
    });
    void commit([...next.values()]);
  }

  function removeEntry(id: string) {
    void commit(entries.filter((entry) => entry.id !== id));
  }

  async function onImportFile(file: File) {
    try {
      const lower = file.name.toLowerCase();
      let next: LogEntry[];
      let note: string;
      if (lower.endsWith('.json')) {
        const imported = entriesFromJson(await file.text());
        next = mergeLog(entries, imported, replaceImport);
        note = `${replaceImport ? 'Replaced the log with' : 'Merged'} ${imported.length} entries from JSON.`;
      } else if (lower.endsWith('.xlsx')) {
        const rows = readXlsxRows(new Uint8Array(await file.arrayBuffer()));
        const chosen = chooseCaptured(rows);
        if (chosen.ids.length === 0) throw new Error('No Messier names in the even-numbered columns.');
        const marked = spreadsheetEntries(chosen.ids, log);
        next = replaceImport ? marked : mergeLog(entries, marked, false);
        note = `Marked ${chosen.ids.length} captured from ${chosen.rule}.`;
      } else {
        const rows = parseCsv(await file.text());
        if (isLogCsv(rows)) {
          const imported = entriesFromLogRows(rows);
          next = mergeLog(entries, imported, replaceImport);
          note = `${replaceImport ? 'Replaced the log with' : 'Merged'} ${imported.length} CSV entries.`;
        } else {
          const chosen = chooseCaptured(rows);
          if (chosen.ids.length === 0) throw new Error('No Messier names in the even-numbered columns.');
          const marked = spreadsheetEntries(chosen.ids, log);
          next = replaceImport ? marked : mergeLog(entries, marked, false);
          note = `Marked ${chosen.ids.length} captured from ${chosen.rule}.`;
        }
      }
      await commit(next);
      setImportNote(note);
    } catch (cause) {
      setImportNote(cause instanceof Error ? cause.message : 'That file could not be read.');
    }
  }

  function download(filename: string, contents: string, type: string) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function useGps() {
    if (!navigator.geolocation) {
      setGpsNote('This browser has no location service. Type a latitude and longitude.');
      return;
    }
    setGpsNote('Listening for GPS…');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Math.round(position.coords.latitude * 1000) / 1000;
        const lon = Math.round(position.coords.longitude * 1000) / 1000;
        const home = nearHome(lat, lon);
        void updateSettings({
          lat,
          lon,
          locationLabel: home ? 'GPS · Sylmar home' : 'GPS fix',
          patio: home,
        });
        setGpsNote(home ? 'GPS is at home. The patio horizon stays available.' : 'Away from Sylmar. Switched to the flat horizon.');
      },
      () => setGpsNote('GPS was blocked. Use the Sylmar preset or type coordinates.'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  const messier = placed.filter((item) => isMessier(item.object.id));
  const messierCaptured = messier.filter((item) => log.has(item.object.id)).length;
  const horizonLabel = settings.patio
    ? profile && profile.length >= 2
      ? `${bundle?.horizon?.name ?? 'Patio'} +2°`
      : 'Patio profile missing, using flat horizon'
    : `Flat horizon ${settings.flatHorizon}°`;

  if (error) {
    return (
      <div class="app">
        <main class="error">
          <h1>Patio Sky</h1>
          <p>{error}</p>
        </main>
      </div>
    );
  }
  if (!bundle) {
    return (
      <div class="app">
        <main class="loading">
          <h1>Patio Sky</h1>
          <p>Loading the catalogs onto this tablet…</p>
        </main>
      </div>
    );
  }

  const selectedId = route.name === 'constellation' ? route.id : null;
  const visibleConst = upOnly ? constViews.filter((item) => item.state !== 'down') : constViews;

  return (
    <div class="app">
      <header class="top">
        <div class="top-row">
          <div class="brand">
            <strong>Patio Sky</strong>
            <span>
              {messierCaptured}/{messier.length} Messier
            </span>
          </div>
          <div class="clock">
            <b>{when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b>
            <span>{when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
        <div class="when-row">
          <button class="now" type="button" onClick={() => { setOffsetMin(0); setTick(Date.now()); }}>
            Now
          </button>
          <input
            type="range"
            min={-12 * 60}
            max={18 * 60}
            step={5}
            value={offsetMin}
            aria-label="Time offset in minutes"
            onInput={(event) => setOffsetMin(Number((event.target as HTMLInputElement).value))}
          />
          <span class="note">{offsetMin === 0 ? 'live' : formatOffset(offsetMin)}</span>
        </div>
        <p class="place">
          {settings.locationLabel} · {settings.lat.toFixed(2)}°, {formatLon(settings.lon)} · {horizonLabel}
          {!online && <span class="offline"> · Offline</span>}
        </p>
      </header>
      <main>
        {route.name === 'sky' && (
          <div class="sky-layout">
            <div>
              <SkyChart
                items={constViews}
                project={project}
                horizon={profile}
                patio={settings.patio}
                flatHorizon={settings.flatHorizon}
                showBounds={showBounds}
                selected={selectedId}
                onSelect={(id) => go(`#const/${id}`)}
              />
              <div class="tools">
                <button class={upOnly ? 'chip on' : 'chip'} type="button" onClick={() => setUpOnly((value) => !value)}>
                  {upOnly ? 'Up now' : 'All 88'}
                </button>
                <button class={showBounds ? 'chip on' : 'chip'} type="button" onClick={() => setShowBounds((value) => !value)}>
                  Boundaries
                </button>
              </div>
              <p class="note">Zenith is the center, north is up. Shaded rim is the horizon in use. The hatched northeast wedge is the streetlight gap at home.</p>
            </div>
            <div class="const-scroll list">
              {visibleConst.map((item) => {
                const counts = tally(byCon.get(item.con.id) ?? [], log);
                return (
                  <button key={item.con.id} class="row" type="button" onClick={() => go(`#const/${item.con.id}`)}>
                    <span>
                      <strong class="name">{item.con.name}</strong>
                      <span class="sub">
                        Messier {counts.messierDone}/{counts.messierTotal}
                        {counts.ngcTotal > 0 ? ` · NGC ${counts.ngcDone}/${counts.ngcTotal}` : ''}
                      </span>
                    </span>
                    <span class="meta">
                      <b>{formatAlt(item.alt)}</b>
                      <span>{formatAz(item.az)}</span>
                      <span class={`state ${item.state}`}>{item.state === 'up' ? 'Up' : item.state === 'partial' ? 'Partly' : 'Down'}</span>
                    </span>
                  </button>
                );
              })}
              {visibleConst.length === 0 && <p class="empty">Nothing is above the horizon at this time.</p>}
            </div>
          </div>
        )}

        {route.name === 'constellation' && (
          <ConstellationPage
            id={route.id}
            views={constViews}
            objects={byCon.get(route.id) ?? []}
            placedById={placedById}
            log={log}
            onOpen={(id) => go(`#object/${encodeURIComponent(id)}`)}
          />
        )}

        {route.name === 'tonight' && (
          <TonightPage
            placed={placed}
            log={log}
            names={names}
            sort={sort}
            setSort={setSort}
            group={group}
            setGroup={setGroup}
            magLimit={magLimit}
            setMagLimit={setMagLimit}
            minAlt={minAlt}
            setMinAlt={setMinAlt}
            messierOnly={messierOnly}
            setMessierOnly={setMessierOnly}
            minute={minute}
            settings={settings}
            profile={profile}
            onOpen={(id) => go(`#object/${encodeURIComponent(id)}`)}
          />
        )}

        {route.name === 'catalog' && (
          <CatalogPage
            placed={placed}
            log={log}
            names={names}
            query={query}
            setQuery={setQuery}
            limit={catalogLimit}
            setLimit={setCatalogLimit}
            onOpen={(id) => go(`#object/${encodeURIComponent(id)}`)}
          />
        )}

        {route.name === 'object' && (
          <ObjectPage
            placed={placedById.get(route.id) ?? null}
            entry={log.get(route.id)}
            constellation={names.get(placedById.get(route.id)?.object.con ?? '') ?? ''}
            when={when}
            minute={minute}
            settings={settings}
            profile={profile}
            onSave={(status, draft) => saveEntry(route.id, status, draft)}
            onRemove={() => removeEntry(route.id)}
          />
        )}

        {route.name === 'log' && (
          <LogPage
            entries={entries}
            messierCaptured={messierCaptured}
            messierTotal={messier.length}
            seed={bundle.seed}
            importNote={importNote}
            replaceImport={replaceImport}
            setReplaceImport={setReplaceImport}
            fileRef={fileRef}
            onExportJson={() => download(`patio-sky-log-${todayInput(when)}.json`, logToJson(entries), 'application/json')}
            onExportCsv={() => download(`patio-sky-log-${todayInput(when)}.csv`, logToCsv(entries), 'text/csv')}
            onFile={(file) => void onImportFile(file)}
            onOpen={(id) => go(`#object/${encodeURIComponent(id)}`)}
            onRestore={() => {
              if (!bundle.seed) return;
              void commit(mergeLog(entries, seedEntries(bundle.seed.captured), false));
              setImportNote(`Restored ${bundle.seed.captured.length} spreadsheet captures.`);
            }}
            onClear={() => setConfirming(true)}
          />
        )}

        {route.name === 'settings' && (
          <SettingsPage
            settings={settings}
            gpsNote={gpsNote}
            horizonReady={Boolean(profile && profile.length >= 2)}
            when={when}
            offsetMin={offsetMin}
            onGps={useGps}
            onHome={() => {
              void updateSettings({ lat: SYLMAR.lat, lon: SYLMAR.lon, locationLabel: SYLMAR.label, patio: true });
              setGpsNote('Sylmar home. Patio horizon is on.');
            }}
            onSettings={updateSettings}
            onTime={(value) => {
              const picked = new Date(value);
              if (Number.isNaN(picked.getTime())) return;
              setTick(Date.now());
              setOffsetMin(Math.round((picked.getTime() - Date.now()) / 60000));
            }}
          />
        )}
      </main>
      <nav class="nav">
        <NavButton name="sky" label="Sky" current={route.name} />
        <NavButton name="tonight" label="Tonight" current={route.name} />
        <NavButton name="catalog" label="Catalog" current={route.name} />
        <NavButton name="log" label="Log" current={route.name} />
        <NavButton name="settings" label="Setup" current={route.name} />
      </nav>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,.txt,.xlsx,application/json,text/csv"
        hidden
        onChange={(event) => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (file) void onImportFile(file);
          (event.target as HTMLInputElement).value = '';
        }}
      />
      {confirming && (
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="clear-title">
          <div class="sheet">
            <h2 id="clear-title">Clear the whole log?</h2>
            <p>Captured checks go away on this tablet. Export a backup first if you still want them.</p>
            <div class="actions">
              <button class="danger" type="button" onClick={() => { void commit([]); setConfirming(false); setImportNote('Log cleared.'); }}>
                Clear log
              </button>
              <button class="ghost" type="button" onClick={() => setConfirming(false)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NavButton({ name, label, current }: { name: string; label: string; current: string }) {
  const on = current === name || (name === 'sky' && current === 'constellation') || (name === 'catalog' && current === 'object');
  return (
    <button class={on ? 'on' : ''} type="button" onClick={() => go(`#${name}`)}>
      <Icon name={name} />
      {label}
    </button>
  );
}

function Icon({ name }: { name: string }) {
  if (name === 'sky') return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M12 4v16M4 12h16" /></svg>;
  if (name === 'tonight') return <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M4.9 6.5l2.8 2.8M16.3 14.7l2.8 2.8M3 12h4M17 12h4M6.5 19.1l2.8-2.8M14.7 7.7l2.8-2.8" /></svg>;
  if (name === 'catalog') return <svg viewBox="0 0 24 24"><path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" /></svg>;
  if (name === 'log') return <svg viewBox="0 0 24 24"><path d="M7 4h10v16H7zM9 9l2 2 4-4" /></svg>;
  return <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>;
}

function tally(objects: CatalogObject[], log: Map<string, LogEntry>) {
  let messierTotal = 0;
  let messierDone = 0;
  let ngcTotal = 0;
  let ngcDone = 0;
  for (const object of objects) {
    const done = log.has(object.id);
    if (isMessier(object.id)) {
      messierTotal += 1;
      if (done) messierDone += 1;
    } else {
      ngcTotal += 1;
      if (done) ngcDone += 1;
    }
  }
  return { messierTotal, messierDone, ngcTotal, ngcDone };
}

function ConstellationPage({
  id,
  views,
  objects,
  placedById,
  log,
  onOpen,
}: {
  id: string;
  views: ChartConstellation[];
  objects: CatalogObject[];
  placedById: Map<string, Placed>;
  log: Map<string, LogEntry>;
  onOpen: (id: string) => void;
}) {
  const view = views.find((item) => item.con.id === id);
  if (!view) {
    return (
      <div>
        <button class="ghost" type="button" onClick={() => go('#sky')}>Back to sky</button>
        <p class="empty">That constellation is not in the 88.</p>
      </div>
    );
  }
  const rows = objects
    .map((object) => placedById.get(object.id))
    .filter((item): item is Placed => Boolean(item))
    .sort((a, b) => Number(log.has(a.object.id)) - Number(log.has(b.object.id)) || b.alt - a.alt);
  return (
    <div>
      <button class="ghost" type="button" onClick={() => go('#sky')}>Sky</button>
      <h1>{view.con.name}</h1>
      <p class="hero-alt">{formatAlt(view.alt)}</p>
      <p>
        Center at {formatAz(view.az)}. {view.state === 'up' ? 'The figure’s center is up.' : view.state === 'partial' ? 'Part of the figure is up.' : 'The figure is below the horizon.'}
      </p>
      <p class="note">{rows.filter((item) => !log.has(item.object.id)).length} still missing in this constellation. Missing rows are highlighted.</p>
      <div class="list">
        {rows.map((item) => (
          <ObjectButton key={item.object.id} placed={item} logged={log.get(item.object.id)} onOpen={() => onOpen(item.object.id)} />
        ))}
        {rows.length === 0 && <p class="empty">No catalog objects fall in {view.con.name}.</p>}
      </div>
    </div>
  );
}

function ObjectButton({ placed, logged, onOpen }: { placed: Placed; logged?: LogEntry; onOpen: () => void }) {
  const done = Boolean(logged);
  return (
    <button class={`obj ${done ? 'done' : 'missing'}`} type="button" onClick={onOpen}>
      <span class="check" aria-hidden="true">{done ? '✓' : ''}</span>
      <span>
        <strong>{displayId(placed.object.id)}</strong>{' '}
        <span class="name">{properName(placed.object.id, placed.object.name, placed.object.alias)}</span>
        <span class="sub">
          {placed.object.typeLabel} · mag {formatMag(placed.object.mag)} · {formatSize(placed.object.major, placed.object.minor)}
          {logged ? ` · ${logged.status}` : ''}
        </span>
      </span>
      <span class="meta">
        <b>{formatAlt(placed.alt)}</b>
        <span>{formatAz(placed.az)}</span>
        {placed.poor && placed.visible && <em>streetlights</em>}
        {!placed.visible && <em>below</em>}
      </span>
    </button>
  );
}

function TonightPage(props: {
  placed: Placed[];
  log: Map<string, LogEntry>;
  names: Map<string, string>;
  sort: 'alt' | 'mag' | 'size';
  setSort: (value: 'alt' | 'mag' | 'size') => void;
  group: 'all' | TypeGroup;
  setGroup: (value: 'all' | TypeGroup) => void;
  magLimit: number;
  setMagLimit: (value: number) => void;
  minAlt: number;
  setMinAlt: (value: number) => void;
  messierOnly: boolean;
  setMessierOnly: (value: boolean) => void;
  minute: number;
  settings: Settings;
  profile: { az: number; alt: number }[] | null;
  onOpen: (id: string) => void;
}) {
  const rows = props.placed.filter((item) => {
    if (props.log.has(item.object.id)) return false;
    if (!item.visible) return false;
    if (item.alt < props.minAlt) return false;
    if (props.messierOnly && !isMessier(item.object.id)) return false;
    if (props.group !== 'all' && typeGroup(item.object.type) !== props.group) return false;
    if (item.object.mag == null) return props.magLimit >= 13;
    return item.object.mag <= props.magLimit;
  });
  rows.sort((a, b) => {
    if (props.sort === 'mag') return (a.object.mag ?? 99) - (b.object.mag ?? 99) || b.alt - a.alt;
    if (props.sort === 'size') return (b.object.major ?? 0) - (a.object.major ?? 0) || b.alt - a.alt;
    return b.alt - a.alt;
  });
  const shown = rows.slice(0, 60);
  const date = new Date(props.minute * 60000);
  return (
    <div>
      <h1>Not on the list yet</h1>
      <p class="note">{rows.length} uncaptured objects are up with these filters. Missing ones stay highlighted.</p>
      <div class="filters">
        <div class="tools">
          {(['alt', 'mag', 'size'] as const).map((mode) => (
            <button key={mode} class={props.sort === mode ? 'chip on' : 'chip'} type="button" onClick={() => props.setSort(mode)}>
              {mode === 'alt' ? 'Altitude' : mode === 'mag' ? 'Brightness' : 'Size'}
            </button>
          ))}
          <button class={props.messierOnly ? 'chip on' : 'chip'} type="button" onClick={() => props.setMessierOnly(!props.messierOnly)}>
            Messier only
          </button>
        </div>
        <div class="tools">
          {(['all', 'galaxy', 'nebula', 'cluster', 'planetary', 'other'] as const).map((mode) => (
            <button key={mode} class={props.group === mode ? 'chip on' : 'chip'} type="button" onClick={() => props.setGroup(mode)}>
              {mode}
            </button>
          ))}
        </div>
        <label class="slider-line">
          <span>Mag ≤ {props.magLimit.toFixed(0)}</span>
          <input type="range" min={6} max={13} step={0.5} value={props.magLimit} onInput={(event) => props.setMagLimit(Number((event.target as HTMLInputElement).value))} />
        </label>
        <label class="slider-line">
          <span>Min alt {props.minAlt}°</span>
          <input type="range" min={0} max={60} step={5} value={props.minAlt} onInput={(event) => props.setMinAlt(Number((event.target as HTMLInputElement).value))} />
        </label>
      </div>
      <div class="list">
        {shown.map((item) => {
          const events = riseTransitSet(item.object.ra, item.object.dec, props.settings.lat, props.settings.lon, date, (az) =>
            judgeVisibility(0, az, props.settings, props.profile).required,
          );
          return (
            <div key={item.object.id}>
              <ObjectButton placed={item} onOpen={() => props.onOpen(item.object.id)} />
              <p class="note" style="margin:0 0 8px 44px">
                {props.names.get(item.object.con)} · {eventSummary(events, date)}
              </p>
            </div>
          );
        })}
        {rows.length === 0 && (
          <p class="empty">Nothing uncaptured is above the horizon with these filters. Raise the magnitude limit or lower the minimum altitude.</p>
        )}
      </div>
    </div>
  );
}

function CatalogPage(props: {
  placed: Placed[];
  log: Map<string, LogEntry>;
  names: Map<string, string>;
  query: string;
  setQuery: (value: string) => void;
  limit: number;
  setLimit: (value: number) => void;
  onOpen: (id: string) => void;
}) {
  const needle = props.query.trim().toLowerCase().replace(/\s+/g, '');
  const rows = props.placed.filter((item) => {
    if (!needle) return true;
    const hay = `${item.object.id}${displayId(item.object.id)}${item.object.name}${item.object.alias}${item.object.con}${props.names.get(item.object.con) ?? ''}${item.object.typeLabel}`
      .toLowerCase()
      .replace(/\s+/g, '');
    return hay.includes(needle);
  });
  const shown = rows.slice(0, props.limit);
  return (
    <div>
      <h1>Catalog</h1>
      <p class="note">{props.placed.length} objects. Search by name, M number, NGC, or constellation.</p>
      <input class="search" value={props.query} placeholder="M42, Orion, NGC 1976" onInput={(event) => { props.setQuery((event.target as HTMLInputElement).value); props.setLimit(80); }} />
      <div class="list">
        {shown.map((item) => (
          <ObjectButton key={item.object.id} placed={item} logged={props.log.get(item.object.id)} onOpen={() => props.onOpen(item.object.id)} />
        ))}
        {shown.length === 0 && <p class="empty">No objects match that search.</p>}
      </div>
      {rows.length > shown.length && (
        <button class="btn" type="button" onClick={() => props.setLimit(props.limit + 80)}>
          Show more ({rows.length - shown.length} left)
        </button>
      )}
    </div>
  );
}

function ObjectPage(props: {
  placed: Placed | null;
  entry?: LogEntry;
  constellation: string;
  when: Date;
  minute: number;
  settings: Settings;
  profile: { az: number; alt: number }[] | null;
  onSave: (status: LogEntry['status'], draft: { date: string; scope: string; notes: string }) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState({ date: '', scope: '', notes: '' });
  const id = props.placed?.object.id ?? '';
  useEffect(() => {
    if (!props.placed) return;
    setDraft({
      date: props.entry?.date || todayInput(props.when),
      scope: props.entry?.scope || '',
      notes: props.entry?.notes === 'Imported from Messier spreadsheet' ? '' : props.entry?.notes || '',
    });
  }, [id]);
  if (!props.placed) {
    return (
      <div>
        <button class="ghost" type="button" onClick={() => go('#catalog')}>Catalog</button>
        <p class="empty">That object is not in the catalog.</p>
      </div>
    );
  }
  const item = props.placed;
  const events = riseTransitSet(item.object.ra, item.object.dec, props.settings.lat, props.settings.lon, new Date(props.minute * 60000), (az) =>
    judgeVisibility(0, az, props.settings, props.profile).required,
  );
  return (
    <div>
      <button class="ghost" type="button" onClick={() => history.length > 1 ? history.back() : go('#catalog')}>Back</button>
      <h1>{displayId(item.object.id)}</h1>
      <p class="name" style="font-size:22px">{properName(item.object.id, item.object.name, item.object.alias) || item.object.typeLabel}</p>
      <p class="hero-alt">{formatAlt(item.alt)}</p>
      <p>{formatAz(item.az)} · {verdict(item)}</p>
      <div class="grid-3">
        <div class="stat"><span>Rise</span><b>{events.rise ? formatClock(events.rise, props.when) : events.alwaysUp ? 'Always up' : '—'}</b></div>
        <div class="stat"><span>Transit</span><b>{formatClock(events.transit, props.when)} · {formatAlt(events.transitAlt)}</b></div>
        <div class="stat"><span>Set</span><b>{events.set ? formatClock(events.set, props.when) : events.alwaysUp ? 'No set' : '—'}</b></div>
      </div>
      <h2>Object</h2>
      <p>
        {item.object.typeLabel}
        {item.object.alias && item.object.alias !== displayId(item.object.id) ? ` · ${item.object.alias}` : ''}
      </p>
      <p>Magnitude {formatMag(item.object.mag)} · size {formatSize(item.object.major, item.object.minor)}</p>
      <p>RA {formatRa(item.object.ra)} · Dec {formatDec(item.object.dec)}</p>
      <p>
        <button class="ghost" type="button" onClick={() => go(`#const/${item.object.con}`)}>
          {props.constellation || item.object.con}
        </button>
      </p>
      {events.neverUp && <p>It does not clear the horizon in use. Culmination is the highest it gets.</p>}
      <h2>Log</h2>
      {props.entry && (
        <p class="note">
          Marked {props.entry.status}
          {props.entry.date ? ` on ${props.entry.date}` : ''}
          {props.entry.scope ? ` with ${props.entry.scope}` : ''}.
        </p>
      )}
      <label class="block">
        Date
        <input class="field" type="date" value={draft.date} onInput={(event) => setDraft({ ...draft, date: (event.target as HTMLInputElement).value })} />
      </label>
      <label class="block">
        Scope
        <input class="field" list="scopes" value={draft.scope} onInput={(event) => setDraft({ ...draft, scope: (event.target as HTMLInputElement).value })} />
        <datalist id="scopes">
          {SCOPE_SUGGESTIONS.map((scope) => <option key={scope} value={scope} />)}
        </datalist>
      </label>
      <label class="block">
        Notes
        <textarea value={draft.notes} onInput={(event) => setDraft({ ...draft, notes: (event.target as HTMLTextAreaElement).value })} />
      </label>
      <div class="actions">
        <button class="primary" type="button" onClick={() => props.onSave('captured', draft)}>Save captured</button>
        <button class="btn" type="button" onClick={() => props.onSave('observed', draft)}>Save observed</button>
        {props.entry && <button class="ghost" type="button" onClick={props.onRemove}>Remove from log</button>}
      </div>
    </div>
  );
}

function LogPage(props: {
  entries: LogEntry[];
  messierCaptured: number;
  messierTotal: number;
  seed: SeedFile | null;
  importNote: string;
  replaceImport: boolean;
  setReplaceImport: (value: boolean) => void;
  fileRef: { current: HTMLInputElement | null };
  onExportJson: () => void;
  onExportCsv: () => void;
  onFile: (file: File) => void;
  onOpen: (id: string) => void;
  onRestore: () => void;
  onClear: () => void;
}) {
  const ordered = [...props.entries].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const pct = props.messierTotal ? Math.round((props.messierCaptured / props.messierTotal) * 100) : 0;
  return (
    <div>
      <h1>Log</h1>
      <p>
        {props.messierCaptured} of {props.messierTotal} Messier objects are on the list
        {props.seed ? ` · spreadsheet seed ${props.seed.count}` : ''}.
      </p>
      <div class="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      <div class="actions">
        <button class="primary" type="button" onClick={props.onExportJson}>Export JSON</button>
        <button class="btn" type="button" onClick={props.onExportCsv}>Export CSV</button>
        <button class="btn" type="button" onClick={() => props.fileRef.current?.click()}>Import</button>
      </div>
      <label class="block">
        <span>
          <input type="checkbox" checked={props.replaceImport} onChange={(event) => props.setReplaceImport((event.target as HTMLInputElement).checked)} /> Replace the whole log on import
        </span>
      </label>
      <p class="note">JSON and CSV restore the full log. A Messier spreadsheet, or a CSV exported from it, marks captured names found in even-numbered columns.</p>
      {props.importNote && <p>{props.importNote}</p>}
      <div class="actions">
        {props.seed && <button class="ghost" type="button" onClick={props.onRestore}>Restore spreadsheet seed</button>}
        <button class="ghost" type="button" onClick={props.onClear}>Clear log</button>
      </div>
      <div class="list">
        {ordered.map((entry) => (
          <button key={entry.id} class="row" type="button" onClick={() => props.onOpen(canonicalId(entry.id))}>
            <span>
              <strong class="name">{displayId(entry.id)}</strong>
              <span class="sub">{entry.status}{entry.date ? ` · ${entry.date}` : ''}{entry.scope ? ` · ${entry.scope}` : ''}</span>
            </span>
            <span class="meta"><span>{entry.notes ? entry.notes.slice(0, 42) : ''}</span></span>
          </button>
        ))}
        {ordered.length === 0 && <p class="empty">The log is empty. Import the spreadsheet or mark an object from the catalog.</p>}
      </div>
    </div>
  );
}

function SettingsPage(props: {
  settings: Settings;
  gpsNote: string;
  horizonReady: boolean;
  when: Date;
  offsetMin: number;
  onGps: () => void;
  onHome: () => void;
  onSettings: (patch: Partial<Settings>) => void;
  onTime: (value: string) => void;
}) {
  const [lat, setLat] = useState(String(props.settings.lat));
  const [lon, setLon] = useState(String(props.settings.lon));
  useEffect(() => {
    setLat(String(props.settings.lat));
    setLon(String(props.settings.lon));
  }, [props.settings.lat, props.settings.lon]);
  return (
    <div>
      <h1>Setup</h1>
      <h2>Place</h2>
      <div class="actions">
        <button class="primary" type="button" onClick={props.onHome}>Sylmar home</button>
        <button class="btn" type="button" onClick={props.onGps}>Use GPS</button>
      </div>
      {props.gpsNote && <p>{props.gpsNote}</p>}
      <div class="pair">
        <label class="block">
          Latitude
          <input class="field" inputMode="decimal" value={lat} onInput={(event) => setLat((event.target as HTMLInputElement).value)} />
        </label>
        <label class="block">
          Longitude (west is negative)
          <input class="field" inputMode="decimal" value={lon} onInput={(event) => setLon((event.target as HTMLInputElement).value)} />
        </label>
      </div>
      <button
        class="btn"
        type="button"
        onClick={() => {
          const parsedLat = Number(lat);
          const parsedLon = Number(lon);
          if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon) || Math.abs(parsedLat) > 90 || Math.abs(parsedLon) > 180) return;
          props.onSettings({ lat: parsedLat, lon: parsedLon, locationLabel: 'Manual', patio: nearHome(parsedLat, parsedLon) ? props.settings.patio : false });
        }}
      >
        Save coordinates
      </button>
      <h2>Horizon</h2>
      <button class={props.settings.patio ? 'chip on' : 'chip'} type="button" onClick={() => props.onSettings({ patio: !props.settings.patio })}>
        {props.settings.patio ? 'Home (patio) horizon on' : 'Home (patio) horizon off'}
      </button>
      <p class="note">
        {props.horizonReady
          ? 'At home, an object is up only when its altitude clears the patio line by 2°. Azimuth 20–60° is flagged poor: streetlights/tree gap.'
          : 'The patio profile is not in this build. Away from home, or until the profile is bundled, a flat horizon is used.'}
      </p>
      <label class="slider-line">
        <span>Flat {props.settings.flatHorizon}°</span>
        <input
          type="range"
          min={0}
          max={40}
          step={1}
          value={props.settings.flatHorizon}
          onInput={(event) => props.onSettings({ flatHorizon: Number((event.target as HTMLInputElement).value) })}
        />
      </label>
      <h2>Clock</h2>
      <label class="block">
        Show the sky at
        <input class="field" type="datetime-local" value={localDateInput(props.when)} onChange={(event) => props.onTime((event.target as HTMLInputElement).value)} />
      </label>
      <p class="note">{props.offsetMin === 0 ? 'Tracking the tablet clock.' : 'The header slider is holding a planned time.'}</p>
      <h2>Data</h2>
      <p class="note">
        Constellation figures and boundaries come from d3-celestial (BSD), with IAU boundaries from Davenhall and Leggett, VizieR VI/49.
        Objects are the OpenNGC catalog (CC-BY-SA-4.0) by Mattia Verga: all 110 Messier objects, plus NGC/IC entries of magnitude 13 or brighter, and extended objects with no magnitude but a major axis of at least 2′.
        Altitude and azimuth are computed on the tablet with astronomy-engine. M102 is the Spindle Galaxy, NGC 5866.
      </p>
    </div>
  );
}

function mergeLog(current: LogEntry[], incoming: LogEntry[], replace: boolean): LogEntry[] {
  if (replace) return incoming;
  const map = new Map(current.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const prev = map.get(entry.id);
    if (!prev || entry.updatedAt >= prev.updatedAt) map.set(entry.id, entry);
  }
  return [...map.values()];
}

function verdict(item: Placed): string {
  const gap = item.alt - item.required;
  if (item.poor && item.visible) return 'Above the patio, but in the northeast streetlight gap (azimuth 20–60°).';
  if (item.visible) return `Clears the horizon in use by ${Math.round(gap)}°.`;
  return `Needs ${Math.round(item.required)}° to clear the horizon. It is at ${Math.round(item.alt)}°.`;
}

function eventSummary(events: SkyEvents, now: Date): string {
  if (events.alwaysUp) return `Circumpolar · transit ${formatClock(events.transit, now)}`;
  if (events.neverUp) return `Does not clear · culminates ${formatAlt(events.transitAlt)}`;
  if (events.set && events.rise && events.set < events.rise) return `Sets ${formatClock(events.set, now)}`;
  if (events.rise) return `Rises ${formatClock(events.rise, now)}`;
  return `Transit ${formatClock(events.transit, now)}`;
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${hours}h ${String(mins).padStart(2, '0')}m`;
}

function formatLon(lon: number): string {
  const hemisphere = lon < 0 ? 'W' : 'E';
  return `${Math.abs(lon).toFixed(2)}° ${hemisphere}`;
}
