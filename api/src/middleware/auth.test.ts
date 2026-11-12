import { beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../services/platformSuspensionService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/platformSuspensionService')>();
  return { ...original, isPlatformRestricted: vi.fn() };
});

vi.mock('../services/authService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/authService')>();
  return { ...original, isSessionRevoked: vi.fn(async () => false), isViewAsSessionActive: vi.fn(async () => true) };
});

import { config } from '../config';
import { isSessionRevoked, isViewAsSessionActive, signViewAsToken, verifyAccessToken } from '../services/authService';
import { isPlatformRestricted, isWriteAllowedWhileRestricted } from '../services/platformSuspensionService';
import { authenticate, forgetPlatformRestriction } from './auth';

const restrictedMock = vi.mocked(isPlatformRestricted);
const revokedMock = vi.mocked(isSessionRevoked);

const tokenFor = (role: string, condominiumId: string | null = 'condo-1', sid?: string) =>
  jwt.sign({ sub: 'u-1', id: 'u-1', username: 'ana', role, condominiumId, condominiumName: 'X', mustChangePassword: false, ...(sid ? { sid } : {}) }, config.accessTokenSecret);

// Roda o middleware e devolve o que aconteceu: next() ou a resposta enviada.
// token null + queryToken: simula o token vindo na URL (?token=).
const run = (method: string, url: string, token: string | null, queryToken?: string) => new Promise<{ next: boolean; status?: number; body?: any }>((resolve) => {
  const req: any = { method, originalUrl: url, headers: token ? { authorization: `Bearer ${token}` } : {}, query: queryToken ? { token: queryToken } : {} };
  const res: any = {
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { resolve({ next: false, status: this.statusCode, body }); return this; },
  };
  authenticate(req, res, () => resolve({ next: true }));
});

beforeEach(() => {
  restrictedMock.mockReset();
  restrictedMock.mockResolvedValue(true);
  revokedMock.mockReset();
  revokedMock.mockResolvedValue(false);
  forgetPlatformRestriction();
});

describe('authenticate — sessão e token na URL', () => {
  it('sessão encerrada (logout, "sair dos outros aparelhos") corta o access token na hora', async () => {
    restrictedMock.mockResolvedValue(false);
    revokedMock.mockResolvedValue(true);
    expect(await run('GET', '/invoices', tokenFor('proprietario', 'condo-1', 'sess-1'))).toMatchObject({ next: false, status: 401 });
    expect(revokedMock).toHaveBeenCalledWith('sess-1');
  });

  it('sessão ativa segue normal; token antigo sem sid não consulta a sessão', async () => {
    restrictedMock.mockResolvedValue(false);
    expect(await run('GET', '/invoices', tokenFor('proprietario', 'condo-1', 'sess-1'))).toEqual({ next: true });
    expect(await run('GET', '/invoices', tokenFor('proprietario'))).toEqual({ next: true });
    expect(revokedMock).toHaveBeenCalledTimes(1);
  });

  it('falha ao consultar a sessão libera (mesma política da restrição)', async () => {
    restrictedMock.mockResolvedValue(false);
    revokedMock.mockRejectedValue(new Error('db fora'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await run('GET', '/invoices', tokenFor('proprietario', 'condo-1', 'sess-1'))).toEqual({ next: true });
    warn.mockRestore();
  });

  it('token na URL vale só pra leitura (downloads), nunca pra alterar dados', async () => {
    restrictedMock.mockResolvedValue(false);
    const token = tokenFor('sindico');
    expect(await run('GET', '/invoices/abc/pdf', null, token)).toEqual({ next: true });
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      expect(await run(method, '/users', null, token)).toMatchObject({ next: false, status: 401 });
    }
  });
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

describe('authenticate — "Ver como este usuário" (somente leitura)', () => {
  const viewAsMock = vi.mocked(isViewAsSessionActive);
  const viewAs = { sessionId: 'va-1', adminId: 'admin-1', adminName: 'Admin', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const viewToken = () => signViewAsToken({ id: 'u-9', username: 'patricia', role: 'inquilino', condominiumId: 'condo-1', condominiumName: 'X', mustChangePassword: false }, viewAs);

  beforeEach(() => {
    restrictedMock.mockResolvedValue(false);
    viewAsMock.mockReset();
    viewAsMock.mockResolvedValue(true);
  });

  it('o token carrega a pessoa visualizada e quem está visualizando', () => {
    const user = verifyAccessToken(viewToken());
    expect(user).toMatchObject({ id: 'u-9', role: 'inquilino', condominiumId: 'condo-1', sessionId: null, viewAs: { sessionId: 'va-1', adminId: 'admin-1' } });
  });

  it('lê tudo que a pessoa lê', async () => {
    for (const url of ['/invoices', '/debts?asOf=2026-11-12', '/auth/me', '/notifications']) {
      expect(await run('GET', url, viewToken())).toEqual({ next: true });
    }
    expect(viewAsMock).toHaveBeenCalledWith('va-1');
    expect(revokedMock).not.toHaveBeenCalled();
  });

  it('recusa QUALQUER escrita, inclusive as liberadas em outras regras (termos, push, leitura de aviso, logout)', async () => {
    for (const [method, url] of [['POST', '/space-reservations'], ['PATCH', '/notifications/abc/read'], ['POST', '/auth/terms/accept'], ['POST', '/notifications/devices'], ['POST', '/auth/logout'], ['POST', '/invoices/sync-all'], ['DELETE', '/reports/1'], ['PUT', '/users/1']]) {
      const result = await run(method, url, viewToken());
      expect(result).toMatchObject({ next: false, status: 403, body: { code: 'VIEW_AS_READ_ONLY' } });
    }
  });

  it('a única escrita aceita é encerrar a própria visualização', async () => {
    expect(await run('POST', '/auth/view-as/end', viewToken())).toEqual({ next: true });
    expect((await run('POST', '/auth/view-as/end-x', viewToken())).status).toBe(403);
  });

  it('visualização encerrada ou vencida: 401 com código próprio', async () => {
    viewAsMock.mockResolvedValue(false);
    expect(await run('GET', '/invoices', viewToken())).toMatchObject({ next: false, status: 401, body: { code: 'VIEW_AS_ENDED' } });
  });

  it('falha ao conferir a visualização BLOQUEIA (na dúvida, não age em nome de outra pessoa)', async () => {
    viewAsMock.mockRejectedValue(new Error('db fora'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect((await run('GET', '/invoices', viewToken())).status).toBe(401);
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
