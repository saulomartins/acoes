import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { APP_PLATFORMS, type AppPlatform, getAppVersion, listAppVersions, saveAppVersion, validateAppVersionInput } from '../services/appVersionService';

const router = Router();

const isPlatform = (value: unknown): value is AppPlatform => APP_PLATFORMS.includes(value as AppPlatform);

// Pública de propósito: o app consulta antes do login (a atualização
// obrigatória precisa aparecer até na tela de entrada). Só devolve números de
// versão e o link da loja — nada do condomínio ou do usuário.
router.get('/:platform', asyncHandler(async (req, res) => {
  const { platform } = req.params;
  if (!isPlatform(platform)) return res.status(404).json({ message: 'Plataforma desconhecida.' });
  const version = await getAppVersion(platform);
  return res.json({
    latestVersion: version?.latestVersion ?? null,
    minVersion: version?.minVersion ?? null,
    storeUrl: version?.storeUrl ?? null,
    releaseNotes: version?.releaseNotes ?? null,
  });
}));

router.get('/', authenticate, authorize('admin_geral'), asyncHandler(async (_req, res) => {
  return res.json({ versions: await listAppVersions() });
}));

router.put('/:platform', authenticate, authorize('admin_geral'), asyncHandler(async (req, res) => {
  const { platform } = req.params;
  if (!isPlatform(platform)) return res.status(404).json({ message: 'Plataforma desconhecida.' });
  const validation = validateAppVersionInput(req.body ?? {});
  if (!validation.ok) return res.status(400).json({ message: validation.message });
  return res.json({ version: await saveAppVersion(platform, validation.value, req.user?.id || null) });
}));

export default router;
