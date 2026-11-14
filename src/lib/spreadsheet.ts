import { unzipSync } from 'fflate';
import type { LogEntry, LogStatus } from './types';

const MESSIER = /(?:^|[^A-Za-z0-9])M\s*0*(\d{1,3})(?!\d)/gi;

export function messierIdsInText(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(MESSIER)) {
    const number = Number(match[1]);
    if (number >= 1 && number <= 110) ids.push(`M${number}`);
  }
  return ids;
}

/**
 * Captured names live in even-numbered columns.
 * `oneBasedEven` treats Excel column B, D, F… as the captured columns (column 2, 4, 6).
 */
export function capturedFromRows(rows: string[][], oneBasedEven = true): string[] {
  const found = new Set<string>();
  for (const row of rows) {
    row.forEach((cell, index) => {
      const column = index + 1;
      const even = oneBasedEven ? column % 2 === 0 : index % 2 === 0;
      if (!even) return;
      for (const id of messierIdsInText(String(cell ?? ''))) found.add(id);
    });
  }
  return [...found].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/**
 * Pick the column parity. The spreadsheet is defined as even-numbered columns.
 * If one parity yields 72 names and the other does not, use that one, because
 * that is the known captured count. Otherwise use 1-based even columns.
 */
export function chooseCaptured(rows: string[][]): { ids: string[]; rule: string } {
  const columns = capturedFromRows(rows, true);
  const indexes = capturedFromRows(rows, false);
  if (columns.length === 72 && indexes.length !== 72) {
    return { ids: columns, rule: '1-based even columns (B, D, F, …)' };
  }
  if (indexes.length === 72 && columns.length !== 72) {
    return { ids: indexes, rule: '0-based even indexes (A, C, E, …)' };
  }
  return { ids: columns, rule: '1-based even columns (B, D, F, …)' };
}

function decodeXml(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/[A-Z]+/i)?.[0] ?? 'A';
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function sharedStrings(bytes: Uint8Array | undefined): string[] {
  if (!bytes) return [];
  const xml = new TextDecoder().decode(bytes);
  const strings: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function sheetRows(bytes: Uint8Array, shared: string[]): string[][] {
  const xml = new TextDecoder().decode(bytes);
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] ?? '';
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? 'A1';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? '';
      const index = columnIndex(ref);
      let value = '';
      if (type === 's') {
        const pointer = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '';
        value = shared[Number(pointer)] ?? '';
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join('');
      } else {
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = raw == null ? '' : decodeXml(raw);
      }
      while (cells.length < index) cells.push('');
      cells[index] = value;
    }
    rows.push(cells);
  }
  return rows;
}

export function readXlsxRows(data: Uint8Array): string[][] {
  const files = unzipSync(data);
  const lookup = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(files)) lookup.set(name.replace(/\\/g, '/'), bytes);
  const shared = sharedStrings(lookup.get('xl/sharedStrings.xml'));
  const sheets = [...lookup.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();
  const rows: string[][] = [];
  for (const name of sheets) rows.push(...sheetRows(lookup.get(name)!, shared));
  return rows;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => line.some((value) => value.trim() !== ''));
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function logToCsv(entries: LogEntry[]): string {
  const lines = ['id,status,date,scope,notes,updatedAt'];
  for (const entry of entries) {
    lines.push(
      [entry.id, entry.status, entry.date, entry.scope, entry.notes, entry.updatedAt].map(csvEscape).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function isLogCsv(rows: string[][]): boolean {
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  return header.includes('id') && header.includes('status');
}

export function canonicalId(value: string): string {
  const text = value.trim();
  const messier = text.match(/^M\s*0*(\d{1,3})$/i);
  if (messier) {
    const number = Number(messier[1]);
    if (number >= 1 && number <= 110) return `M${number}`;
  }
  const catalog = text.match(/^(NGC|IC)\s*0*(\d+)$/i);
  if (catalog) return `${catalog[1].toUpperCase()}${Number(catalog[2])}`;
  return text.replace(/\s+/g, '');
}

export function displayId(id: string): string {
  const match = id.match(/^(NGC|IC)(\d+)$/);
  return match ? `${match[1]} ${match[2]}` : id;
}

export function entriesFromLogRows(rows: string[][]): LogEntry[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const index = (name: string) => header.indexOf(name);
  const idCol = index('id');
  const statusCol = index('status');
  if (idCol < 0 || statusCol < 0) return [];
  const dateCol = index('date');
  const scopeCol = index('scope');
  const notesCol = index('notes');
  const updatedCol = index('updatedat');
  const entries: LogEntry[] = [];
  for (const row of rows.slice(1)) {
    const id = canonicalId(row[idCol] ?? '');
    const status = (row[statusCol] ?? '').trim().toLowerCase();
    if (!id || (status !== 'captured' && status !== 'observed')) continue;
    entries.push({
      id,
      status: status as LogStatus,
      date: dateCol >= 0 ? (row[dateCol] ?? '').trim() : '',
      scope: scopeCol >= 0 ? (row[scopeCol] ?? '').trim() : '',
      notes: notesCol >= 0 ? (row[notesCol] ?? '').trim() : '',
      updatedAt: updatedCol >= 0 && row[updatedCol] ? row[updatedCol].trim() : new Date().toISOString(),
      source: 'import',
    });
  }
  return entries;
}

export function entriesFromJson(text: string): LogEntry[] {
  const data = JSON.parse(text) as { entries?: unknown } | unknown[];
  const list = Array.isArray(data) ? data : data.entries;
  if (!Array.isArray(list)) throw new Error('JSON log needs an entries array.');
  const entries: LogEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const id = canonicalId(String(item.id ?? ''));
    const status = String(item.status ?? '');
    if (!id || (status !== 'captured' && status !== 'observed')) continue;
    entries.push({
      id,
      status,
      date: String(item.date ?? ''),
      scope: String(item.scope ?? ''),
      notes: String(item.notes ?? ''),
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
      source: 'import',
    });
  }
  return entries;
}

export function logToJson(entries: LogEntry[]): string {
  return `${JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)}\n`;
}

export function spreadsheetEntries(ids: string[], existing: Map<string, LogEntry>): LogEntry[] {
  const now = new Date().toISOString();
  return ids.map((id) => {
    const prev = existing.get(id);
    return {
      id,
      status: 'captured' as const,
      date: prev?.date ?? '',
      scope: prev?.scope ?? '',
      notes: prev?.notes || 'Imported from Messier spreadsheet',
      updatedAt: now,
      source: prev?.source === 'user' ? 'user' : 'import',
    };
  });
}
