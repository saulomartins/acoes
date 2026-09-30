import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneAndroidReleaseFiles } from './mobileReleaseStorage';

type Row = { id: string; file_path: string | null; file_size: number | null; active: boolean; published_at: number };

// Banco de mentira: responde ao select (ordenado como o SQL real) e aplica o
// update de limpeza nas linhas.
const fakeDb = (rows: Row[]) => async (text: string, params?: unknown[]) => {
  if (text.startsWith('select')) {
    const withFile = rows.filter(row => row.file_path)
      .sort((a, b) => Number(b.active) - Number(a.active) || b.published_at - a.published_at);
    return { rows: withFile };
  }
  const row = rows.find(item => item.id === params?.[0]);
  if (row) Object.assign(row, { file_path: null, file_size: null, active: false });
  return { rows: [] };
};

let directory = '';
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

const apk = (name: string, ageMs = 2 * 60 * 60 * 1000) => {
  const path = join(directory, name);
  writeFileSync(path, Buffer.alloc(1024));
  const time = (Date.now() - ageMs) / 1000;
  utimesSync(path, time, time);
  return path;
};

describe('pruneAndroidReleaseFiles', () => {
  it('mantém só os 2 APKs mais recentes e desativa as linhas antigas', async () => {
    directory = mkdtempSync(join(tmpdir(), 'releases-'));
    const rows: Row[] = [1, 2, 3, 4, 5].map(n => ({ id: `r${n}`, file_path: apk(`r${n}.apk`), file_size: 1024, active: true, published_at: n }));
    const result = await pruneAndroidReleaseFiles(fakeDb(rows), directory, 2);
    expect(result.removedFiles).toBe(3);
    expect(['r5', 'r4'].every(id => existsSync(join(directory, `${id}.apk`)))).toBe(true);
    expect(['r1', 'r2', 'r3'].some(id => existsSync(join(directory, `${id}.apk`)))).toBe(false);
    expect(rows.filter(row => row.file_path).map(row => row.id).sort()).toEqual(['r4', 'r5']);
    expect(rows.find(row => row.id === 'r1')?.active).toBe(false);
  });

  it('nunca apaga a versão ativa, mesmo com uma inativa publicada depois', async () => {
    directory = mkdtempSync(join(tmpdir(), 'releases-'));
    const rows: Row[] = [
      { id: 'current', file_path: apk('current.apk'), file_size: 1024, active: true, published_at: 1 },
      { id: 'newer-inactive-a', file_path: apk('a.apk'), file_size: 1024, active: false, published_at: 3 },
      { id: 'newer-inactive-b', file_path: apk('b.apk'), file_size: 1024, active: false, published_at: 2 },
    ];
    await pruneAndroidReleaseFiles(fakeDb(rows), directory, 2);
    expect(existsSync(join(directory, 'current.apk'))).toBe(true);
    expect(existsSync(join(directory, 'b.apk'))).toBe(false);
  });

  it('apaga APK órfão antigo, mas não um upload recém-gravado', async () => {
    directory = mkdtempSync(join(tmpdir(), 'releases-'));
    const rows: Row[] = [{ id: 'current', file_path: apk('current.apk'), file_size: 1024, active: true, published_at: 1 }];
    apk('old-orphan.apk');
    apk('uploading-now.apk', 0);
    const result = await pruneAndroidReleaseFiles(fakeDb(rows), directory, 2);
    expect(result.removedFiles).toBe(1);
    expect(existsSync(join(directory, 'old-orphan.apk'))).toBe(false);
    expect(existsSync(join(directory, 'uploading-now.apk'))).toBe(true);
    expect(existsSync(join(directory, 'current.apk'))).toBe(true);
  });
});
