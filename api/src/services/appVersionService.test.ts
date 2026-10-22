import { describe, expect, it } from 'vitest';
import { compareVersions, validateAppVersionInput } from './appVersionService';

describe('compareVersions', () => {
  it('compara número a número, não como texto', () => {
    expect(compareVersions('1.7.10', '1.7.9')).toBe(1);
    expect(compareVersions('1.7.3', '1.8.0')).toBe(-1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('validateAppVersionInput', () => {
  const store = 'https://play.google.com/store/apps/details?id=com.appcond.condominio';

  it('aceita tudo vazio (nenhum aviso)', () => {
    expect(validateAppVersionInput({ latestVersion: ' ', minVersion: '' })).toEqual({ ok: true, value: { latestVersion: null, minVersion: null, storeUrl: null, releaseNotes: null } });
  });

  it('aceita versão mais recente com mínima menor ou igual', () => {
    const result = validateAppVersionInput({ latestVersion: '1.7.4', minVersion: '1.7.4', storeUrl: store });
    expect(result.ok).toBe(true);
  });

  it('recusa formato inválido', () => {
    expect(validateAppVersionInput({ latestVersion: '1.7', storeUrl: store }).ok).toBe(false);
    expect(validateAppVersionInput({ latestVersion: '1.7.4', minVersion: 'v1', storeUrl: store }).ok).toBe(false);
  });

  it('recusa mínima maior que a mais recente', () => {
    expect(validateAppVersionInput({ latestVersion: '1.7.4', minVersion: '1.8.0', storeUrl: store })).toEqual({ ok: false, message: 'A versão mínima não pode ser maior que a versão mais recente.' });
  });

  it('exige o link da loja quando há versão', () => {
    expect(validateAppVersionInput({ latestVersion: '1.7.4' }).ok).toBe(false);
    expect(validateAppVersionInput({ latestVersion: '1.7.4', storeUrl: 'http://x' }).ok).toBe(false);
  });

  it('exige a mais recente quando há mínima', () => {
    expect(validateAppVersionInput({ minVersion: '1.7.4', storeUrl: store }).ok).toBe(false);
  });
});
