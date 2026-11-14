import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  capturedFromRows,
  chooseCaptured,
  entriesFromLogRows,
  isLogCsv,
  logToCsv,
  messierIdsInText,
  parseCsv,
  readXlsxRows,
} from '../src/lib/spreadsheet';
import type { LogEntry } from '../src/lib/types';

function xlsx(rows: string[][]): Uint8Array {
  const shared: string[] = [];
  const index = new Map<string, number>();
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, column) => {
          if (!value) return '';
          if (!index.has(value)) {
            index.set(value, shared.length);
            shared.push(value);
          }
          const letter = String.fromCharCode(65 + column);
          return `<c r="${letter}${rowIndex + 1}" t="s"><v>${index.get(value)}</v></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  const strings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared
    .map((value) => `<si><t xml:space="preserve">${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></si>`)
    .join('')}</sst>`;
  return zipSync({
    'xl/sharedStrings.xml': strToU8(strings),
    'xl/worksheets/sheet1.xml': strToU8(sheet),
  });
}

describe('Messier spreadsheet seed', () => {
  it('reads even-numbered columns and strips tabs and whitespace', () => {
    const rows = [
      ['ignore M3', 'M1', 'nope', 'M2\t'],
      ['M4', '  M80\t ', '', 'M110'],
      ['', 'm007', 'M999', 'M 42'],
    ];
    expect(capturedFromRows(rows, true)).toEqual(['M1', 'M2', 'M7', 'M42', 'M80', 'M110']);
    expect(messierIdsInText('M80\t')).toEqual(['M80']);
  });

  it('reads the same names back out of an xlsx workbook', () => {
    const rows = readXlsxRows(xlsx([
      ['skip', 'M80\t'],
      ['M3', '  M13 '],
    ]));
    expect(rows[0][1]).toBe('M80\t');
    expect(capturedFromRows(rows, true)).toEqual(['M13', 'M80']);
  });

  it('keeps the parity that matches the known 72 when the columns disagree', () => {
    const evenColumns = Array.from({ length: 72 }, (_, index) => ['', `M${index + 1}`]);
    const chosen = chooseCaptured(evenColumns);
    expect(chosen.ids).toHaveLength(72);
    expect(chosen.rule).toContain('1-based');
  });
});

describe('log csv', () => {
  it('round-trips notes that contain commas and quotes', () => {
    const entry: LogEntry = {
      id: 'M42',
      status: 'captured',
      date: '2026-11-01',
      scope: 'Celestron C8',
      notes: 'core, "good" night',
      updatedAt: '2026-11-14T20:00:00.000Z',
      source: 'user',
    };
    const csv = logToCsv([entry]);
    const rows = parseCsv(csv);
    expect(isLogCsv(rows)).toBe(true);
    expect(entriesFromLogRows(rows)).toMatchObject([
      { id: 'M42', status: 'captured', notes: 'core, "good" night', scope: 'Celestron C8' },
    ]);
  });
});
