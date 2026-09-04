import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Router } from 'express';

const router = Router();

// Manuais estáticos (HTML autocontido, sem dependência de dados). Público de
// propósito — quem recebe o link do síndico (ex. por WhatsApp) não precisa
// estar logado para abrir; o app só decide qual link mostrar depois do login.
const MANUALS = {
  sindico: resolve(process.cwd(), 'src', 'assets', 'help', 'sindico.html'),
  morador: resolve(process.cwd(), 'src', 'assets', 'help', 'morador.html'),
} as const;

const cache = new Map<string, string>();
const loadManual = (key: keyof typeof MANUALS) => {
  const cached = cache.get(key);
  if (cached) return cached;
  const content = readFileSync(MANUALS[key], 'utf8');
  cache.set(key, content);
  return content;
};

router.get('/sindico', (_req, res) => {
  res.type('html').send(loadManual('sindico'));
});

router.get('/morador', (_req, res) => {
  res.type('html').send(loadManual('morador'));
});

export default router;
