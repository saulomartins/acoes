import type { Request } from 'express';
import { query } from '../db';

export type AuditFeature =
  | 'pessoas'
  | 'tipologias'
  | 'blocos_unidades'
  | 'prestacao_contas'
  | 'gestao_cobrancas'
  | 'gestao_debitos'
  | 'historico_acordos'
  | 'config_enviar_cobrancas'
  | 'cobrancas_adicionais'
  | 'consumo_individualizado'
  | 'enquetes'
  | 'reserva_espacos'
  | 'regimento'
  | 'ocorrencias'
  | 'notificacoes_infracao';

// Por padrão só audita sindico/subsindico (admin_geral e moradores ficam
// fora do escopo deste log). Exceção: em Regimento/Ocorrências/Notificações
// de infração, proprietário e inquilino também têm ações relevantes (abrir
// ocorrência, responder, dar ciência, contestar) e por isso são auditados
// nessas features específicas. Nunca deve derrubar a ação principal: falhas
// aqui só vão pro console.
const RESIDENT_AUDITABLE_FEATURES: AuditFeature[] = ['regimento', 'ocorrencias', 'notificacoes_infracao', 'enquetes', 'reserva_espacos'];

export const logAudit = async (
  req: Request,
  feature: AuditFeature,
  action: string,
  description: string,
  opts?: { entityId?: string | null; details?: unknown },
) => {
  const role = req.user?.role;
  const isManager = role === 'sindico' || role === 'subsindico';
  const isAuditableResident = (role === 'proprietario' || role === 'inquilino') && RESIDENT_AUDITABLE_FEATURES.includes(feature);
  if (!isManager && !isAuditableResident) return;
  const condominiumId = req.user?.condominiumId;
  if (!condominiumId) return;
  try {
    await query(
      `insert into audit_log(condominium_id,actor_id,actor_role,actor_name,feature,action,entity_id,description,details)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        condominiumId,
        req.user?.id || null,
        role,
        req.user?.fullName || req.user?.username || 'desconhecido',
        feature,
        action,
        opts?.entityId || null,
        description,
        opts?.details ? JSON.stringify(opts.details) : null,
      ],
    );
  } catch (error) {
    console.error('Falha ao gravar audit_log', { feature, action, error });
  }
};
