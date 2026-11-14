import type { LogEntry, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const DB_NAME = 'patio-sky';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed to open'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

let preferLocal = false;

function localEntries(): LogEntry[] {
  const raw = localStorage.getItem('patio-sky-log');
  return raw ? (JSON.parse(raw) as LogEntry[]) : [];
}

function writeLocalEntries(entries: LogEntry[]): void {
  localStorage.setItem('patio-sky-log', JSON.stringify(entries));
}

async function readAll(): Promise<LogEntry[]> {
  if (preferLocal || typeof indexedDB === 'undefined') return localEntries();
  const db = await openDb();
  try {
    const tx = db.transaction('log', 'readonly');
    const request = tx.objectStore('log').getAll();
    const entries = new Promise<LogEntry[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as LogEntry[]);
      request.onerror = () => reject(request.error);
    });
    const done = transactionDone(tx);
    const result = await entries;
    await done;
    return result;
  } finally {
    db.close();
  }
}

async function writeAll(entries: LogEntry[]): Promise<void> {
  writeLocalEntries(entries);
  if (preferLocal || typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    const tx = db.transaction('log', 'readwrite');
    const store = tx.objectStore('log');
    store.clear();
    for (const entry of entries) store.put(entry);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

async function kvGet(key: string): Promise<string | null> {
  if (preferLocal || typeof indexedDB === 'undefined') return localStorage.getItem(`patio-sky-${key}`);
  const db = await openDb();
  try {
    const tx = db.transaction('kv', 'readonly');
    const request = tx.objectStore('kv').get(key);
    const value = new Promise<string | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error);
    });
    const done = transactionDone(tx);
    const result = await value;
    await done;
    return result ?? null;
  } finally {
    db.close();
  }
}

async function kvSet(key: string, value: string): Promise<void> {
  localStorage.setItem(`patio-sky-${key}`, value);
  if (preferLocal || typeof indexedDB === 'undefined') return;
  const db = await openDb();
  try {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export function seedEntries(ids: string[]): LogEntry[] {
  const now = new Date().toISOString();
  return ids.map((id) => ({
    id,
    status: 'captured' as const,
    date: '',
    scope: '',
    notes: 'Imported from Messier spreadsheet',
    updatedAt: now,
    source: 'seed' as const,
  }));
}

export async function loadLog(seedIds: string[] | null): Promise<LogEntry[]> {
  let existing: LogEntry[] = [];
  try {
    existing = await readAll();
  } catch {
    preferLocal = true;
    existing = localEntries();
  }
  let seeded = false;
  try {
    seeded = (await kvGet('seeded')) === '1';
  } catch {
    preferLocal = true;
    seeded = localStorage.getItem('patio-sky-seeded') === '1';
  }
  if (!seeded && existing.length === 0 && seedIds && seedIds.length > 0) {
    const entries = seedEntries(seedIds);
    await replaceLog(entries);
    await kvSet('seeded', '1').catch(() => {
      preferLocal = true;
      localStorage.setItem('patio-sky-seeded', '1');
    });
    return entries;
  }
  if (!seeded && existing.length > 0) {
    await kvSet('seeded', '1').catch(() => localStorage.setItem('patio-sky-seeded', '1'));
  }
  return existing;
}

export async function replaceLog(entries: LogEntry[]): Promise<void> {
  try {
    await writeAll(entries);
  } catch {
    preferLocal = true;
    writeLocalEntries(entries);
  }
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = (await kvGet('settings')) ?? localStorage.getItem('patio-sky-settings');
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Settings) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const raw = JSON.stringify(settings);
  try {
    await kvSet('settings', raw);
  } catch {
    preferLocal = true;
    localStorage.setItem('patio-sky-settings', raw);
  }
}
