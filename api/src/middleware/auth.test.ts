import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../services/platformSuspensionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/platformSuspensionService')>();
  return { ...original, isPlatformRestricted: vi.fn() };
});

import { config } from '../config';
import { isPlatformRestricted, isWriteAllowedWhileRestricted } from '../services/platformSuspensionService';
import { authenticate, forgetPlatformRestriction } from './auth';

const restrictedMock = vi.mocked(isPlatformRestricted);

const tokenFor = (role: string, condominiumId: string | null = 'condo-1') =>
  jwt.sign({ sub: 'u-1', id: 'u-1', username: 'ana', role, condominiumId, condominiumName: 'X', mustChangePassword: false }, config.accessTokenSecret);

// Roda o middleware e devolve o que aconteceu: next() ou a resposta enviada.
const run = (method: string, url: string, token: string) => new Promise<{ next: boolean; status?: number; body?: any }>((resolve) => {
  const req: any = { method, originalUrl: url, headers: { authorization: `Bearer ${token}` }, query: {} };
  const res: any = {
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { resolve({ next: false, status: this.statusCode, body }); return this; },
  };
  authenticate(req, res, () => resolve({ next: true }));
});

beforeEach(() => {
  restrictedMock.mockReset();
  restrictedMock.mockResolvedValue(true);
  forgetPlatformRestriction();
});

describe('authenticate — gestão somente leitura por inadimplência', () => {
  it('síndico de condomínio restrito não consegue alterar nada fora da lista liberada', async () => {
    const result = await run('POST', '/users', tokenFor('sindico'));
    expect(result).toMatchObject({ next: false, status: 403, body: { code: 'PLATFORM_RESTRICTED' } });
    expect(result.body.message).toContain('somente leitura');
    expect((await run('PATCH', '/billing/settings?x=1', tokenFor('subsindico'))).status).toBe(403);
    expect((await run('DELETE', '/units/abc', tokenFor('sindico'))).status).toBe(403);
  });

  it('continua lendo tudo (GET), inclusive exportações e recibos', async () => {
    expect(await run('GET', '/users/export?ids=1', tokenFor('sindico'))).toEqual({ next: true });
    expect(await run('GET', '/condominiums/platform-invoices/abc/receipt', tokenFor('sindico'))).toEqual({ next: true });
    expect(restrictedMock).not.toHaveBeenCalled();
  });

  it('pode pagar/verificar a fatura, usar login e termos, notificações e suporte a morador', async () => {
    for (const url of ['/condominiums/platform-invoice/verify', '/auth/terms/accept', '/auth/logout', '/notifications/abc/read', '/support/users/abc/reset-password']) {
      expect(await run('POST', url, tokenFor('sindico'))).toEqual({ next: true });
    }
    expect(restrictedMock).not.toHaveBeenCalled();
  });

  it('prefixo parecido não escapa da restrição', async () => {
    expect((await run('POST', '/condominiums/platform-invoices-hack', tokenFor('sindico'))).status).toBe(403);
    expect((await run('POST', '/supportx', tokenFor('sindico'))).status).toBe(403);
  });

  it('admin geral nunca é restringido', async () => {
    expect(await run('POST', '/platform-plans/invoices/generate', tokenFor('admin_geral', null))).toEqual({ next: true });
    expect(restrictedMock).not.toHaveBeenCalled();
  });

  it('condomínio em dia: segue normal', async () => {
    restrictedMock.mockResolvedValue(false);
    expect(await run('POST', '/users', tokenFor('sindico'))).toEqual({ next: true });
    expect(restrictedMock).toHaveBeenCalledWith('condo-1');
  });

  it('falha ao consultar a restrição (ex.: migração pendente) LIBERA em vez de travar a gestão', async () => {
    restrictedMock.mockRejectedValue(new Error('column "suspension_clock_from" does not exist'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await run('POST', '/users', tokenFor('sindico'))).toEqual({ next: true });
    warn.mockRestore();
  });

  it('token inválido continua dando 401 antes de qualquer checagem', async () => {
    expect(await run('POST', '/users', 'lixo')).toMatchObject({ next: false, status: 401 });
    expect(restrictedMock).not.toHaveBeenCalled();
  });
});

describe('authenticate — morador de condomínio suspenso (bloqueio total)', () => {
  it('bloqueia tudo, leitura inclusive, com a mensagem de suspensão', async () => {
    for (const [method, url] of [['GET', '/invoices'], ['GET', '/accountability?month=2026-09'], ['POST', '/space-reservations'], ['POST', '/reports']]) {
      const result = await run(method, url, tokenFor('proprietario'));
      expect(result).toMatchObject({ next: false, status: 403, body: { code: 'PLATFORM_SUSPENDED' } });
      expect(result.body.message).toBe('O acesso ao Lar em Dia está temporariamente indisponível para o seu condomínio. Para mais informações, entre em contato com a administração do condomínio.');
      expect(result.body.message).not.toMatch(/pagamento|síndico/i); // neutra: não expõe o motivo
    }
    expect((await run('GET', '/invoices', tokenFor('inquilino'))).status).toBe(403);
  });

  it('libera só sessão/termos/status (/auth) e o registro do aparelho pro push', async () => {
    for (const [method, url] of [['GET', '/auth/access-status'], ['GET', '/auth/me'], ['POST', '/auth/terms/accept'], ['POST', '/notifications/devices'], ['DELETE', '/notifications/devices']]) {
      expect(await run(method, url, tokenFor('proprietario'))).toEqual({ next: true });
    }
    expect((await run('GET', '/notifications', tokenFor('proprietario'))).status).toBe(403);
  });

  it('condomínio em dia: morador segue normal', async () => {
    restrictedMock.mockResolvedValue(false);
    expect(await run('GET', '/invoices', tokenFor('proprietario'))).toEqual({ next: true });
  });

  it('usa cache de 30 s por condomínio (o app faz muitas chamadas) e forgetPlatformRestriction limpa', async () => {
    await run('GET', '/invoices', tokenFor('proprietario'));
    await run('GET', '/reports', tokenFor('inquilino'));
    expect(restrictedMock).toHaveBeenCalledTimes(1);

    restrictedMock.mockResolvedValue(false); // pagou
    expect((await run('GET', '/invoices', tokenFor('proprietario'))).status).toBe(403); // ainda no cache
    forgetPlatformRestriction('condo-1'); // /auth/access-status viu que liberou
    expect(await run('GET', '/invoices', tokenFor('proprietario'))).toEqual({ next: true });
  });

  it('falha na consulta libera o morador (e não fica em cache)', async () => {
    restrictedMock.mockRejectedValueOnce(new Error('db fora'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await run('GET', '/invoices', tokenFor('proprietario'))).toEqual({ next: true });
    expect((await run('GET', '/invoices', tokenFor('proprietario'))).status).toBe(403);
    warn.mockRestore();
  });
});

describe('isWriteAllowedWhileRestricted', () => {
  it('leitura sempre liberada; escrita só nos prefixos da lista', () => {
    expect(isWriteAllowedWhileRestricted('get', '/qualquer')).toBe(true);
    expect(isWriteAllowedWhileRestricted('OPTIONS', '/users')).toBe(true);
    expect(isWriteAllowedWhileRestricted('POST', '/auth/switch-profile')).toBe(true);
    expect(isWriteAllowedWhileRestricted('POST', '/notifications')).toBe(true);
    expect(isWriteAllowedWhileRestricted('POST', '/support')).toBe(true);
    expect(isWriteAllowedWhileRestricted('POST', '/authx')).toBe(false);
    expect(isWriteAllowedWhileRestricted('POST', '/condominiums/platform-invoices')).toBe(false);
    expect(isWriteAllowedWhileRestricted('PUT', '/users/1')).toBe(false);
  });
});
