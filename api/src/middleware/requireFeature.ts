import type { NextFunction, Request, Response } from 'express';
import { query } from '../db';
import type { FeatureKey } from '../services/featureCatalog';

// Gate por módulo, por condomínio. `feature` é sempre um literal de código
// no ponto de montagem da rota (nunca vem de req.*), então interpolar o
// nome da coluna aqui não é um vetor de injeção controlável pelo cliente.
export const requireFeature = (feature: FeatureKey) => async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ message: 'authorization token is required' });
  if (req.user.role === 'admin_geral') return next();

  const condominiumId = req.user.condominiumId;
  if (!condominiumId) return res.status(400).json({ message: 'Condomínio obrigatório.' });

  try {
    const result = await query<Record<string, boolean>>(
      `select ${feature} as enabled from condominium_features where condominium_id=$1`,
      [condominiumId],
    );
    // Sem linha configurada para o condomínio = tudo ativo por padrão.
    const enabled = result.rows[0] ? result.rows[0].enabled : true;
    if (!enabled) return res.status(403).json({ message: 'Esta funcionalidade não está disponível para o seu condomínio.' });
    return next();
  } catch (error) {
    return next(error);
  }
};
