import bcrypt from 'bcrypt';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import { buildInitialPassword, buildManagerInitialPassword } from '../services/passwordRuleService';
import { sendWelcomeEmail, sendPasswordResetByAdminEmail } from '../services/emailService';
import { CURRENT_TERMS_VERSION } from './authRoutes';

// Ferramenta de suporte para corrigir conta sem SQL manual: um conjunto fixo
// de ações (nunca edição livre de banco), sempre localizadas por usuário +
// condomínio. admin_geral age em qualquer condomínio (inclusive sobre
// síndico/subsíndico, exceto outro admin_geral); síndico/subsíndico agem só
// sobre moradores (proprietário/inquilino) do PRÓPRIO condomínio — mesma
// divisão de autoridade que routes/userRoutes.ts POST /reset-password já usa
// (allowedRoles por papel de quem age). Ver OPERACAO_PRODUCAO_PARA_IA.md,
// publicações de 04/09 e 06/09/2026.
const router = Router();
router.use(authenticate);
router.use(authorize('admin_geral', 'sindico', 'subsindico'));
router.use(requireFeature('pessoas'));

const RESIDENT_ROLES = ['proprietario', 'inquilino'];

const resolveCondominiumId = (req: any): string =>
  req.user?.role === 'admin_geral'
    ? String(req.query?.condominiumId || req.body?.condominiumId || '')
    : String(req.user?.condominiumId || '');

type TargetUser = {
  id: string; full_name: string | null; username: string; email: string | null; cpf: string | null;
  role: string; condominium_id: string; condominium_name: string | null; unit_id: string | null; unit_number: string | null;
  login_enabled: boolean; deleted_at: Date | null; terms_accepted_version: string | null; terms_accepted_at: Date | null;
};

const loadTarget = async (id: string, condominiumId: string): Promise<TargetUser | null> => {
  const result = await query<TargetUser>(
    `select u.id, u.full_name, u.username, u.email, u.cpf, u.role, u.condominium_id, c.name condominium_name,
            u.unit_id, un.number unit_number, u.login_enabled, u.deleted_at, u.terms_accepted_version, u.terms_accepted_at
     from users u
     left join condominiums c on c.id = u.condominium_id
     left join units un on un.id = u.unit_id
     where u.id=$1 and u.condominium_id=$2`,
    [id, condominiumId],
  );
  return result.rows[0] || null;
};

// Resolve condomínio + carrega o alvo + aplica a mesma restrição de papel do
// reset de senha em massa: síndico/subsíndico só podem agir sobre moradores.
// Centralizado aqui pra não repetir em cada uma das 6 rotas abaixo.
const loadAuthorizedTarget = async (req: any, res: any): Promise<TargetUser | null> => {
  const condominiumId = resolveCondominiumId(req);
  if (!condominiumId) { res.status(400).json({ message: 'Selecione o condomínio.' }); return null; }
  const target = await loadTarget(req.params.id, condominiumId);
  if (!target) { res.status(404).json({ message: 'Pessoa não encontrada neste condomínio.' }); return null; }
  if (req.user?.role !== 'admin_geral' && !RESIDENT_ROLES.includes(target.role)) {
    res.status(403).json({ message: 'Você só pode agir sobre moradores (proprietário/inquilino) do seu condomínio.' });
    return null;
  }
  return target;
};

// Grava direto em audit_log (em vez de logAudit()) porque logAudit ignora
// admin_geral por design e lê condominium_id de req.user, que admin_geral
// não tem — aqui o condomínio relevante é o da PESSOA ALVO, para o síndico
// daquele condomínio conseguir ver em Auditoria quando foi o admin (e não
// ele mesmo) quem mexeu na conta.
const logSupportAction = async (req: any, target: TargetUser, action: string, description: string) => {
  try {
    await query(
      `insert into audit_log(condominium_id,actor_id,actor_role,actor_name,feature,action,entity_id,description)
       values($1,$2,$3,$4,'suporte_admin',$5,$6,$7)`,
      [target.condominium_id, req.user?.id || null, req.user?.role || 'desconhecido', req.user?.fullName || req.user?.username || 'suporte', action, target.id, description],
    );
  } catch (error) {
    console.error('Falha ao gravar audit_log de suporte', { action, targetId: target.id, error });
  }
};

// Lista de pessoas do condomínio pra tela escolher quem vai receber a ação.
// Não reaproveita GET /users porque esse endpoint, pra admin_geral, só
// devolve síndico/subsíndico (regra da tela Pessoas) — aqui precisa de todo
// mundo (quando quem pergunta é admin_geral) ou só moradores (quando é
// síndico/subsíndico, já que é só isso que ele pode acionar).
router.get('/people', asyncHandler(async (req, res) => {
  const condominiumId = resolveCondominiumId(req);
  if (!condominiumId) return res.status(400).json({ message: 'Selecione o condomínio.' });
  const roles = req.user?.role === 'admin_geral' ? null : RESIDENT_ROLES;
  const result = await query<{ id: string; full_name: string | null; username: string; cpf: string | null; role: string; unit: string | null }>(
    `select u.id, u.full_name, u.username, u.cpf, u.role, coalesce(b.name || ' / ' || un.number, u.unit) as unit
     from users u
     left join units un on un.id = u.unit_id
     left join blocks b on b.id = un.block_id
     where u.condominium_id=$1 and u.deleted_at is null and ($2::text[] is null or u.role::text = any($2::text[]))
     order by u.full_name, u.username`,
    [condominiumId, roles],
  );
  return res.json({ users: result.rows });
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const target = await loadAuthorizedTarget(req, res);
  if (!target) return;
  const activeSession = await query<{ exists: boolean }>(
    `select exists(select 1 from refresh_tokens where user_id=$1 and revoked_at is null and expires_at>now()) as exists`,
    [target.id],
  );
  return res.json({ user: { ...target, hasActiveSession: activeSession.rows[0]?.exists || false } });
}));

router.post('/users/:id/force-logout', asyncHandler(async (req, res) => {
  const target = await loadAuthorizedTarget(req, res);
  if (!target) return;
  const revoked = await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [target.id]);
  await logSupportAction(req, target, 'force_logout', `Forçou logout de ${target.full_name || target.username} (${revoked.rowCount} sessão(ões) revogada(s))`);
  return res.json({ message: `${revoked.rowCount} sessão(ões) revogada(s). Na próxima abertura do app, a pessoa precisará logar de novo.` });
}));

router.post('/users/:id/unlock-login', asyncHandler(async (req, res) => {
  const target = await loadAuthorizedTarget(req, res);
  if (!target) return;
  if (target.deleted_at) return res.status(400).json({ message: 'Esta conta está excluída — use "Reativar" em Pessoas em vez de Destravar login.' });
  await query(`update users set login_enabled=true where id=$1`, [target.id]);
  await logSupportAction(req, target, 'unlock_login', `Destravou o login de ${target.full_name || target.username}`);
  return res.json({ message: 'Login destravado.' });
}));

// Compartilhada por resetar-senha e reenviar-boas-vindas: mesma geração de
// senha do reset em massa (routes/userRoutes.ts POST /reset-password), só
// muda o template de e-mail enviado ao final.
const rotatePasswordAndNotify = async (req: any, res: any, emailSender: typeof sendWelcomeEmail | typeof sendPasswordResetByAdminEmail, action: string, actionLabel: string) => {
  const target = await loadAuthorizedTarget(req, res);
  if (!target) return;
  if (target.role === 'admin_geral') return res.status(400).json({ message: 'Não é possível redefinir a senha de outro admin_geral por aqui.' });
  const cpfDigits = target.cpf ? String(target.cpf).replace(/\D/g, '') : '';
  if (!cpfDigits) return res.status(400).json({ message: 'Cadastro sem CPF — não é possível gerar a senha.' });
  const isResident = target.role === 'proprietario' || target.role === 'inquilino';
  if (isResident && !target.unit_number) return res.status(400).json({ message: 'Cadastro sem unidade — não é possível gerar a senha.' });
  const newPassword = isResident ? buildInitialPassword(target.unit_number as string, cpfDigits) : buildManagerInitialPassword(cpfDigits);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await query(
    `update users set password_hash=$1, must_change_password=true,
       login_enabled=case when deleted_at is null then true else login_enabled end
     where id=$2`,
    [passwordHash, target.id],
  );
  await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [target.id]);
  let emailSent = false;
  if (target.email) {
    try {
      const emailResult = await emailSender(target.email, target.full_name || target.username, target.username, newPassword, target.condominium_name || '');
      emailSent = emailResult.status === 'sent';
    } catch (error) {
      console.error(`Failed to send ${action} email`, error);
    }
  }
  await logSupportAction(req, target, action, `${actionLabel} de ${target.full_name || target.username}`);
  return res.json({ newPassword, emailSent, message: emailSent ? 'Senha redefinida e e-mail enviado.' : 'Senha redefinida, mas o e-mail não foi enviado (confira o cadastro).' });
};

router.post('/users/:id/reset-password', asyncHandler((req, res) =>
  rotatePasswordAndNotify(req, res, sendPasswordResetByAdminEmail, 'reset_password', 'Redefiniu a senha')));

router.post('/users/:id/resend-welcome-email', asyncHandler((req, res) =>
  rotatePasswordAndNotify(req, res, sendWelcomeEmail, 'resend_welcome_email', 'Reenviou o e-mail de acesso (com nova senha)')));

router.post('/users/:id/clear-terms-acceptance', asyncHandler(async (req, res) => {
  const target = await loadAuthorizedTarget(req, res);
  if (!target) return;
  await query(`update users set terms_accepted_version=null, terms_accepted_at=null where id=$1`, [target.id]);
  await query(`delete from user_terms_acceptances where user_id=$1 and terms_version=$2`, [target.id, CURRENT_TERMS_VERSION]);
  await logSupportAction(req, target, 'clear_terms_acceptance', `Limpou o aceite dos Termos de Uso de ${target.full_name || target.username}`);
  return res.json({ message: 'Aceite dos Termos de Uso limpo — a pessoa verá a tela de Termos no próximo acesso.' });
}));

export default router;
