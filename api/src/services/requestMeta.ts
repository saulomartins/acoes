import type { Request } from 'express';

// Origem de uma requisição pra auditoria e "Dispositivos conectados". O IP só
// é o do cliente porque app.ts confia em UM proxy (o do Railway) — ver
// `trust proxy` lá. Tamanhos limitados: são dados enviados pelo cliente.
export type RequestMeta = { ip: string | null; userAgent: string | null };

export const requestMeta = (req: Request): RequestMeta => ({
  ip: (req.ip || req.socket?.remoteAddress || '').slice(0, 100) || null,
  userAgent: String(req.headers?.['user-agent'] || '').slice(0, 500) || null,
});
