import bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { requireFeature } from '../middleware/requireFeature';
import { asyncHandler } from '../middleware/asyncHandler';
import { query, withTransaction } from '../db';
import type { UserRole } from '../types';
import { buildInitialPassword, buildManagerInitialPassword } from '../services/passwordRuleService';
import { sendWelcomeEmail, sendPasswordResetByAdminEmail } from '../services/emailService';
import { logAudit } from '../services/auditService';
import { listProfiles } from '../services/authService';

const router = Router();
const validRoles: UserRole[] = ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'];
const managerCreatedRoles: UserRole[] = ['subsindico', 'proprietario', 'inquilino'];

router.use(authenticate);
// GET / fica de fora do gate: é usada como diretório de pessoas por outras
// funcionalidades já gateadas separadamente (ex.: busca de destinatário em
// Avisos e comunicação, lista de cobrança em Config. e enviar cobranças).
// Só as ações de gestão de cadastro (criar/editar/excluir/redefinir senha)
// são de fato o módulo "Pessoas".

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? req.query.condominiumId : req.user?.condominiumId;
  const deletedOnly = req.query.deletedOnly === 'true';

  const result = await query(
    `select users.id, users.username, users.full_name, users.cpf, users.email, users.phone, users.role,
            users.condominium_id, users.unit_id, coalesce(blocks.name || ' / ' || units.number, users.unit) as unit, units.unit_type_id, users.billing_exempt, users.preferred_due_day, users.unit_rented_to_tenant, users.created_at,
            users.street, users.address_number, users.address_complement, users.neighborhood, users.city, users.state, users.postal_code, users.deleted_at,
            unit_types.name as unit_type_name, unit_types.fee_cents as condominium_fee_cents,
            exists(select 1 from unit_occupancies uo where uo.user_id=users.id and uo.unit_id=users.unit_id and uo.ended_at is null and uo.is_representative=true) as is_unit_representative
     from users
     left join units on units.id = users.unit_id
     left join blocks on blocks.id = units.block_id
     left join unit_types on unit_types.id = units.unit_type_id
     where ($1::uuid is null or users.condominium_id = $1)
       and ($2::boolean = false or users.role in ('sindico','subsindico'))
       and (($3::boolean and users.deleted_at is not null) or (not $3::boolean and users.deleted_at is null))
     order by users.created_at desc`,
    [condominiumId || null, req.user?.role === 'admin_geral', deletedOnly],
  );

  return res.json({ users: result.rows });
}));

// Mascara o CPF/CNPJ para exposição fora do sistema (planilha exportada) —
// exigência de LGPD: mantém só os dígitos das pontas, o suficiente para
// conferência visual, sem expor o documento completo.
const maskDocument = (raw: string | null) => {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}.***.***-${digits.slice(9)}`;
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  return 'Não informado';
};

// Planilha de Pessoas para o gestor levar a informação para fora do sistema
// (ex.: assembleia, prestação de contas) sem expor o CPF completo. `ids`
// vem da lista já filtrada na tela — exporta exatamente o que está visível
// ali, e a query abaixo ainda restringe ao condomínio/papéis que este
// usuário pode enxergar, como defesa em profundidade.
router.get('/export', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!ids.length) return res.status(400).json({ message: 'Nenhuma pessoa selecionada para exportar.' });

  const condominiumId = req.user?.role === 'admin_geral' ? null : req.user?.condominiumId;
  const result = await query<{ full_name: string | null; username: string; cpf: string | null; unit: string | null }>(
    `select users.full_name, users.username, users.cpf,
            coalesce(blocks.name || ' / ' || units.number, users.unit) as unit
     from users
     left join units on units.id = users.unit_id
     left join blocks on blocks.id = units.block_id
     where users.id = any($1::uuid[])
       and ($2::uuid is null or users.condominium_id = $2)
       and ($3::boolean = false or users.role in ('sindico','subsindico'))
       and users.deleted_at is null
     order by users.full_name nulls last, users.username`,
    [ids, condominiumId || null, req.user?.role === 'admin_geral'],
  );

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pessoas');
  sheet.columns = [
    { header: 'Nome completo', key: 'fullName', width: 32 },
    { header: 'Usuário de acesso', key: 'username', width: 22 },
    { header: 'CPF', key: 'cpf', width: 18 },
    { header: 'Unidade / apartamento', key: 'unit', width: 26 },
  ];
  for (const row of result.rows) {
    sheet.addRow({
      fullName: row.full_name || row.username,
      username: row.username,
      cpf: maskDocument(row.cpf),
      unit: row.unit || 'Não informado',
    });
  }
  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="pessoas.xlsx"');
  return res.send(Buffer.from(buffer));
}));

router.post('/', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const { username, password, role, condominiumId, fullName, cpf, email, phone, unitId, billingExempt, preferredDueDay,
    unitRentedToTenant, street, addressNumber, addressComplement, neighborhood, city, state, postalCode } = req.body ?? {};

  const isResident = role === 'proprietario' || role === 'inquilino';

  if (!username || !role || typeof username !== 'string') {
    return res.status(400).json({ message: 'username and role are required' });
  }

  if (!validRoles.includes(role)) {
    return res.status(400).json({ message: 'invalid role' });
  }

  if (role === 'admin_geral') {
    return res.status(400).json({ message: 'admin_geral cannot be created from this route' });
  }

  const targetCondominiumId = req.user?.role === 'admin_geral' ? condominiumId : req.user?.condominiumId;

  if (req.user?.role === 'admin_geral' && role !== 'sindico' && role !== 'subsindico') {
    return res.status(403).json({ message: 'Administrador geral pode cadastrar somente síndicos e subsíndicos.' });
  }

  if (req.user?.role !== 'admin_geral' && !managerCreatedRoles.includes(role)) {
    return res.status(403).json({ message: 'condominium managers can create only subsindico, proprietario or inquilino users' });
  }

  if (!targetCondominiumId) {
    return res.status(400).json({ message: 'condominiumId is required' });
  }

  const cpfDigits = cpf ? String(cpf).replace(/\D/g, '') : null;
  const phoneDigits = phone ? String(phone).replace(/\D/g, '') : null;
  const normalizedUsername = username.trim().toLowerCase();

  if (cpfDigits && ![11, 14].includes(cpfDigits.length)) {
    return res.status(400).json({ message: 'CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos' });
  }
  if (!cpfDigits) {
    return res.status(400).json({ message: 'Informe o CPF — ele é necessário para gerar a senha inicial.' });
  }

  // unaccent(): "joao" e "joão" devem ser tratados como o mesmo usuário de
  // acesso — impede criar uma segunda conta que colidiria no login (ver
  // login() em authService.ts).
  const existingUsername = await query(`select id from users where unaccent(lower(username)) = unaccent($1)`, [normalizedUsername]);
  if (existingUsername.rows[0]) {
    return res.status(409).json({ message: 'Usuário de acesso já cadastrado. Escolha outro nome de usuário.' });
  }

  if (cpfDigits && unitId) {
    const existingCpf = await query(`select id from users where regexp_replace(coalesce(cpf, ''), '[^0-9]', '', 'g') = $1 and unit_id=$2`, [cpfDigits, unitId]);
    if (existingCpf.rows[0]) {
      return res.status(409).json({ message: 'CPF já cadastrado para outra pessoa.' });
    }
  }

  if (isResident && !unitId) {
    return res.status(400).json({ message: 'Selecione a unidade do morador.' });
  }
  const selectedUnit = unitId ? await query<{id:string;number:string;unit_type_id:string|null}>(`select id,number,unit_type_id from units where id=$1 and condominium_id=$2 and active=true`,[unitId,targetCondominiumId]) : null;
  if (unitId && !selectedUnit?.rows[0]) return res.status(400).json({ message:'Unidade inválida para o condomínio.' });

  const condominium = await query<{ name: string }>(`select name from condominiums where id=$1`, [targetCondominiumId]);
  const condominiumName = condominium.rows[0]?.name || '';
  const plainPassword = isResident ? buildInitialPassword(selectedUnit!.rows[0].number, cpfDigits!) : buildManagerInitialPassword(cpfDigits!);
  const initialPassword = plainPassword;
  const passwordHash = await bcrypt.hash(plainPassword, 10);
  const result = await query(
    `insert into users (id, username, password_hash, role, condominium_id, full_name, cpf, email, phone, unit, unit_id, billing_exempt, preferred_due_day, unit_rented_to_tenant,
       street, address_number, address_complement, neighborhood, city, state, postal_code, must_change_password)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
     returning id, username, full_name, cpf, email, phone, role, condominium_id, unit, unit_id, billing_exempt, preferred_due_day, unit_rented_to_tenant, created_at`,
    [
      randomUUID(),
      normalizedUsername,
      passwordHash,
      role,
      targetCondominiumId,
      fullName || null,
      cpfDigits,
      email || null,
      phoneDigits,
      selectedUnit?.rows[0]?.number || null,
      unitId || null,
      Boolean(billingExempt),
      Number(preferredDueDay) === 20 ? 20 : 10,
      role === 'proprietario' && Boolean(unitRentedToTenant),
      street || null, addressNumber || null, addressComplement || null, neighborhood || null,
      city || null, state ? String(state).trim().toUpperCase() : null,
      postalCode ? String(postalCode).replace(/\D/g, '') : null,
      true,
    ],
  );

  if (unitId && (role === 'proprietario' || role === 'inquilino')) {
    // Quem acabou de ser vinculado à unidade vira automaticamente o
    // representante — não existe mais escolha manual dessa opção.
    await query(`update unit_occupancies set is_representative=false where unit_id=$1 and ended_at is null`,[unitId]);
    await query(`insert into unit_occupancies(unit_id,user_id,is_representative) values($1,$2,true)`,[unitId,(result.rows[0] as any).id]);
  }

  let emailSent = false;
  if (email) {
    try {
      const emailResult = await sendWelcomeEmail(email, fullName || normalizedUsername, normalizedUsername, plainPassword, condominiumName);
      emailSent = emailResult.status === 'sent';
    } catch (error) {
      console.error('Failed to send welcome email', error);
    }
  }

  await logAudit(req, 'pessoas', 'created', `Cadastrou ${fullName || normalizedUsername} (${role})`, { entityId: String((result.rows[0] as any).id) });
  return res.status(201).json({ user: result.rows[0], initialPassword, emailSent });
}));

router.patch('/:id', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const { username, password, role, condominiumId, fullName, cpf, email, phone, unitId, billingExempt, preferredDueDay,
    unitRentedToTenant, street, addressNumber, addressComplement, neighborhood, city, state, postalCode } = req.body ?? {};
  const current = await query<{ id: string; role: UserRole; condominium_id: string | null; unit_id:string|null }>(
    `select id, role, condominium_id, unit_id from users where id = $1`, [req.params.id],
  );
  const target = current.rows[0];
  if (!target) return res.status(404).json({ message: 'Usuário não encontrado.' });

  const nextRole = (role || target.role) as UserRole;
  const isManagerRole = (value: UserRole) => value === 'sindico' || value === 'subsindico';
  // Admin geral normalmente só edita gestores (síndico/subsíndico) — mas também
  // precisa conseguir RECUPERAR alguém cujo perfil de gestor foi perdido por
  // engano (ex.: perfil principal sobrescrito ao editar em "Pessoas"), senão
  // ninguém mais consegue promover essa pessoa de volta. Por isso o gate
  // libera quando o perfil atual OU o perfil solicitado é de gestor.
  if (req.user?.role === 'admin_geral' && !isManagerRole(target.role) && !isManagerRole(nextRole)) {
    return res.status(403).json({ message: 'Administrador geral pode editar somente síndicos e subsíndicos.' });
  }
  if (req.user?.role !== 'admin_geral' && target.condominium_id !== req.user?.condominiumId) {
    return res.status(403).json({ message: 'Usuário não pertence ao seu condomínio.' });
  }
  if (req.user?.role === 'admin_geral' && !isManagerRole(nextRole)) {
    return res.status(403).json({ message: 'Administrador geral pode manter somente os perfis síndico e subsíndico.' });
  }
  if (req.user?.role !== 'admin_geral' && !managerCreatedRoles.includes(nextRole)) {
    return res.status(403).json({ message: 'Perfil inválido para a gestão do condomínio.' });
  }

  const targetCondominiumId = req.user?.role === 'admin_geral' ? condominiumId || target.condominium_id : req.user?.condominiumId;
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const cpfDigits = cpf ? String(cpf).replace(/\D/g, '') : null;
  const phoneDigits = phone ? String(phone).replace(/\D/g, '') : null;
  if (!normalizedUsername) return res.status(400).json({ message: 'Usuário de acesso é obrigatório.' });
  if (cpfDigits && ![11, 14].includes(cpfDigits.length)) return res.status(400).json({ message: 'CPF deve ter 11 dígitos ou CNPJ deve ter 14 dígitos.' });

  const usernameConflict = await query(`select id from users where unaccent(lower(username)) = unaccent($1) and id <> $2`, [normalizedUsername, req.params.id]);
  if (usernameConflict.rows[0]) return res.status(409).json({ message: 'Usuário de acesso já cadastrado para outra pessoa.' });
  if (cpfDigits && unitId) {
    const cpfConflict = await query(`select id from users where regexp_replace(coalesce(cpf, ''), '[^0-9]', '', 'g') = $1 and unit_id=$2 and id <> $3`, [cpfDigits, unitId, req.params.id]);
    if (cpfConflict.rows[0]) return res.status(409).json({ message: 'CPF já cadastrado para outra pessoa.' });
  }

  if ((nextRole === 'proprietario' || nextRole === 'inquilino') && !unitId) {
    return res.status(400).json({ message: 'Unidade e tipologia são obrigatórias para moradores.' });
  }
  const selectedUnit = unitId ? await query<{id:string;number:string;unit_type_id:string|null}>(`select id,number,unit_type_id from units where id=$1 and condominium_id=$2 and active=true`,[unitId,targetCondominiumId]) : null;
  if (unitId && !selectedUnit?.rows[0]) return res.status(400).json({ message:'Unidade inválida para o condomínio.' });

  const result = await query(
    `update users set username = $1, role = $2,
       condominium_id = $3, full_name = $4, cpf = $5, email = $6, phone = $7, unit = $8, unit_id=$9, unit_type_id = null, billing_exempt=$10, preferred_due_day=$11, unit_rented_to_tenant=$12,
       street = $13, address_number = $14, address_complement = $15, neighborhood = $16,
       city = $17, state = $18, postal_code = $19,
       login_enabled = case when deleted_at is null then true else login_enabled end
     where id = $20
     returning id, username, full_name, cpf, email, phone, role, condominium_id, unit, unit_id, billing_exempt, preferred_due_day, unit_rented_to_tenant, created_at`,
    [normalizedUsername, nextRole, targetCondominiumId, fullName || null, cpfDigits, email || null, phoneDigits,
      selectedUnit?.rows[0]?.number || null, unitId || null, Boolean(billingExempt), Number(preferredDueDay) === 20 ? 20 : 10,
      nextRole === 'proprietario' && Boolean(unitRentedToTenant),
      street || null, addressNumber || null, addressComplement || null,
      neighborhood || null, city || null, state ? String(state).trim().toUpperCase() : null,
      postalCode ? String(postalCode).replace(/\D/g, '') : null, req.params.id],
  );
  if (target.unit_id && target.unit_id !== unitId) {
    await query(`update unit_occupancies set ended_at=current_date,is_representative=false where unit_id=$1 and user_id=$2 and ended_at is null`,[target.unit_id,req.params.id]);
    // Sem essa pessoa, o representante da unidade antiga passa pro morador
    // restante vinculado mais recentemente (se sobrar algum).
    await query(`update unit_occupancies set is_representative=true where id=(select id from unit_occupancies where unit_id=$1 and ended_at is null order by started_at desc limit 1)`,[target.unit_id]);
  }
  if (unitId && (nextRole === 'proprietario' || nextRole === 'inquilino')) {
    // Quem acabou de ser vinculado à unidade vira automaticamente o
    // representante — não existe mais escolha manual dessa opção.
    await query(`update unit_occupancies set is_representative=false where unit_id=$1 and ended_at is null`,[unitId]);
    await query(`insert into unit_occupancies(unit_id,user_id,is_representative) values($1,$2,true) on conflict (unit_id,user_id) where ended_at is null do update set is_representative=true`,[unitId,req.params.id]);
  }
  await logAudit(req, 'pessoas', 'updated', `Editou ${result.rows[0].full_name || result.rows[0].username}`, { entityId: req.params.id });
  return res.json({ user: result.rows[0] });
}));

router.post('/reset-password', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const isAdmin = req.user?.role === 'admin_geral';
  const allowedRoles = isAdmin ? ['sindico', 'subsindico'] : ['proprietario', 'inquilino'];
  const condominiumId = isAdmin ? String(req.body?.condominiumId || '') : req.user?.condominiumId;
  if (!condominiumId) {
    return res.status(400).json({ message: isAdmin ? 'Selecione um condomínio para resetar em massa.' : 'Usuário sem condomínio.' });
  }

  const { role, ids } = req.body ?? {};
  const hasRole = role === 'all' || allowedRoles.includes(role);
  const hasIds = Array.isArray(ids) && ids.length > 0;
  if (hasRole === hasIds) {
    return res.status(400).json({ message: `Informe role (${allowedRoles.join(', ')} ou all) ou uma lista de ids, não os dois.` });
  }

  const targets = await query<{ id: string; username: string; full_name: string | null; cpf: string | null; unit_id: string | null; email: string | null; role: UserRole }>(
    hasIds
      ? `select id, username, full_name, cpf, unit_id, email, role from users where condominium_id=$1 and role::text = any($2::text[]) and id = any($3::uuid[])`
      : role === 'all'
        ? `select id, username, full_name, cpf, unit_id, email, role from users where condominium_id=$1 and role::text = any($2::text[])`
        : `select id, username, full_name, cpf, unit_id, email, role from users where condominium_id=$1 and role=$2`,
    hasIds ? [condominiumId, allowedRoles, ids] : role === 'all' ? [condominiumId, allowedRoles] : [condominiumId, role],
  );

  if (!targets.rows.length) return res.json({ results: [], skipped: [] });

  const condominium = await query<{ name: string }>(`select name from condominiums where id=$1`, [condominiumId]);
  const condoName = condominium.rows[0]?.name || '';

  const unitIds = [...new Set(targets.rows.map((person) => person.unit_id).filter(Boolean))] as string[];
  const units = unitIds.length ? await query<{ id: string; number: string }>(`select id, number from units where id = any($1::uuid[])`, [unitIds]) : { rows: [] as Array<{ id: string; number: string }> };
  const unitNumberById = new Map(units.rows.map((unit) => [unit.id, unit.number]));

  const results: Array<{ id: string; fullName: string | null; username: string; newPassword: string; emailSent: boolean }> = [];
  const skipped: Array<{ id: string; fullName: string | null; reason: string }> = [];

  for (const person of targets.rows) {
    const cpfDigits = person.cpf ? String(person.cpf).replace(/\D/g, '') : '';
    const isPersonResident = person.role === 'proprietario' || person.role === 'inquilino';
    if (!cpfDigits) {
      skipped.push({ id: person.id, fullName: person.full_name, reason: 'Cadastro sem CPF — não é possível gerar a senha.' });
      continue;
    }
    let newPassword: string;
    if (isPersonResident) {
      const unitNumber = person.unit_id ? unitNumberById.get(person.unit_id) : null;
      if (!unitNumber) {
        skipped.push({ id: person.id, fullName: person.full_name, reason: 'Cadastro sem unidade — não é possível gerar a senha.' });
        continue;
      }
      newPassword = buildInitialPassword(unitNumber, cpfDigits);
    } else {
      newPassword = buildManagerInitialPassword(cpfDigits);
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query(
      `update users set password_hash=$1, must_change_password=true,
         login_enabled=case when deleted_at is null then true else login_enabled end
       where id=$2`,
      [passwordHash, person.id],
    );
    await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [person.id]);
    let emailSent = false;
    if (person.email) {
      try {
        const emailResult = await sendPasswordResetByAdminEmail(person.email, person.full_name || person.username, person.username, newPassword, condoName);
        emailSent = emailResult.status === 'sent';
      } catch (error) {
        console.error('Failed to send password reset notification email', error);
      }
    }
    results.push({ id: person.id, fullName: person.full_name, username: person.username, newPassword, emailSent });
  }

  if (results.length) await logAudit(req, 'pessoas', 'reset_password', `Resetou a senha de ${results.length} pessoa(s)`, { details: { ids: results.map((r) => r.id) } });
  return res.json({ results, skipped });
}));

// admin_geral gerencia sindico/subsindico; sindico/subsindico gerenciam proprietario/inquilino do próprio condomínio.
const findDeletableTarget = async (req: any, id: string) => {
  const isAdmin = req.user?.role === 'admin_geral';
  const allowedRoles: UserRole[] = isAdmin ? ['sindico', 'subsindico'] : ['proprietario', 'inquilino'];
  const result = await query<{ id: string; role: UserRole; condominium_id: string | null; deleted_at: Date | null; full_name: string | null; username: string }>(
    `select id, role, condominium_id, deleted_at, full_name, username from users where id = $1`, [id],
  );
  const target = result.rows[0];
  if (!target || !allowedRoles.includes(target.role)) return null;
  if (!isAdmin && target.condominium_id !== req.user?.condominiumId) return null;
  return target;
};

router.delete('/:id', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const target = await findDeletableTarget(req, req.params.id);
  if (!target) return res.status(404).json({ message: 'Pessoa não encontrada.' });
  const isResident = target.role === 'proprietario' || target.role === 'inquilino';
  try {
    if (isResident) {
      const openDebt = await query<{ count: number }>(
        `select count(*)::int as count from invoices where user_id=$1 and status not in ('paid','canceled')`,
        [target.id],
      );
      if (openDebt.rows[0].count > 0) {
        return res.status(409).json({ message: 'Não é possível excluir fisicamente: esta pessoa tem débito em aberto com o condomínio. Quite ou cancele os débitos antes de excluir.' });
      }
      await withTransaction(async (client) => {
        await client.query(`delete from inter_issuance_guards where user_id=$1`, [target.id]);
        await client.query(`delete from debt_agreements where debtor_user_id=$1`, [target.id]);
        await client.query(`delete from users where id=$1`, [target.id]);
      });
    } else {
      await query(`delete from users where id=$1`, [target.id]);
    }
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ message: 'Não é possível excluir: existem registros vinculados a esta pessoa que impedem a exclusão física.' });
    }
    throw error;
  }
  await logAudit(req, 'pessoas', 'deleted', `Excluiu fisicamente ${target.full_name || target.username}`, { entityId: target.id });
  return res.status(204).send();
}));

router.post('/:id/soft-delete', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const target = await findDeletableTarget(req, req.params.id);
  if (!target) return res.status(404).json({ message: 'Pessoa não encontrada.' });
  await query(`update users set deleted_at=now(), login_enabled=false where id=$1`, [target.id]);
  await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and revoked_at is null`, [target.id]);
  await logAudit(req, 'pessoas', 'soft_deleted', `Excluiu logicamente ${target.full_name || target.username}`, { entityId: target.id });
  return res.status(204).send();
}));

router.post('/:id/reactivate', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const target = await findDeletableTarget(req, req.params.id);
  if (!target) return res.status(404).json({ message: 'Pessoa não encontrada.' });
  await query(`update users set deleted_at=null, login_enabled=true where id=$1`, [target.id]);
  await logAudit(req, 'pessoas', 'reactivated', `Reativou ${target.full_name || target.username}`, { entityId: target.id });
  return res.status(204).send();
}));

// Perfis extras de um mesmo login (ex.: síndico que também é proprietário
// de uma unidade), trocados manualmente pelo usuário via POST
// /auth/switch-profile — ver authService.ts. MVP: restrito ao mesmo
// condomínio e (para papéis de morador) à mesma unidade já cadastrada.
const profileRoles: UserRole[] = ['sindico', 'subsindico', 'proprietario', 'inquilino'];

router.get('/:id/profiles', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  return res.json({ profiles: await listProfiles(req.params.id) });
}));

router.post('/:id/profiles', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const role = req.body?.role as UserRole;
  const unitId = req.body?.unitId ? String(req.body.unitId) : null;
  if (!profileRoles.includes(role)) return res.status(400).json({ message: 'Perfil inválido.' });
  // Mesma regra de quem pode atribuir qual papel já usada na criação normal
  // de pessoas (POST /users) — sem isso um subsíndico poderia conceder a si
  // mesmo ou a outra pessoa um perfil extra de síndico.
  if (req.user?.role === 'admin_geral' && role !== 'sindico' && role !== 'subsindico') {
    return res.status(403).json({ message: 'Administrador geral pode conceder somente perfis de síndico e subsíndico.' });
  }
  if (req.user?.role !== 'admin_geral' && !managerCreatedRoles.includes(role)) {
    return res.status(403).json({ message: 'Gestores do condomínio podem conceder somente perfis de subsíndico, proprietário ou inquilino.' });
  }

  const targetCondominiumId = req.user?.role === 'admin_geral' ? String(req.body?.condominiumId || '') : req.user?.condominiumId;
  if (!targetCondominiumId) return res.status(400).json({ message: 'condominiumId is required' });

  const target = await query<{ id: string; unit_id: string | null; condominium_id: string | null; full_name: string | null; username: string }>(
    `select id, unit_id, condominium_id, full_name, username from users where id=$1`, [req.params.id],
  );
  const person = target.rows[0];
  if (!person) return res.status(404).json({ message: 'Pessoa não encontrada.' });
  if (person.condominium_id && person.condominium_id !== targetCondominiumId) {
    return res.status(400).json({ message: 'Perfis adicionais só são permitidos dentro do mesmo condomínio nesta versão.' });
  }

  const isResidentProfile = role === 'proprietario' || role === 'inquilino';
  if (isResidentProfile && !unitId) return res.status(400).json({ message: 'Selecione a unidade para o perfil de morador.' });
  if (isResidentProfile && person.unit_id && unitId && person.unit_id !== unitId) {
    return res.status(409).json({ message: 'Esta pessoa já possui outra unidade como principal; perfis de morador adicionais precisam apontar para a mesma unidade.' });
  }

  const result = await query(
    `insert into user_profiles(user_id, role, condominium_id, created_by) values($1,$2,$3,$4)
     on conflict (user_id, role, condominium_id) do nothing
     returning id, role, condominium_id`,
    [req.params.id, role, targetCondominiumId, req.user?.id],
  );
  if (!result.rows[0]) return res.status(409).json({ message: 'Esta pessoa já tem esse perfil.' });

  if (isResidentProfile && unitId && !person.unit_id) {
    const unit = await query<{ number: string }>(`select number from units where id=$1 and condominium_id=$2 and active=true`, [unitId, targetCondominiumId]);
    if (!unit.rows[0]) return res.status(400).json({ message: 'Unidade inválida para o condomínio.' });
    await query(`update users set unit_id=$1, unit=$2, condominium_id=coalesce(condominium_id,$3) where id=$4`, [unitId, unit.rows[0].number, targetCondominiumId, req.params.id]);
    const occupancy = await query(`select id from unit_occupancies where unit_id=$1 and user_id=$2 and ended_at is null`, [unitId, req.params.id]);
    if (!occupancy.rows[0]) await query(`insert into unit_occupancies(unit_id,user_id) values($1,$2)`, [unitId, req.params.id]);
  }

  await logAudit(req, 'pessoas', 'updated', `Concedeu o perfil adicional de ${role} a ${person.full_name || person.username}`, { entityId: req.params.id });
  return res.status(201).json({ profile: result.rows[0] });
}));

router.delete('/:id/profiles/:profileId', authorize('admin_geral', 'sindico', 'subsindico'), requireFeature('pessoas'), asyncHandler(async (req, res) => {
  const deleted = await query(`delete from user_profiles where id=$1 and user_id=$2 returning id`, [req.params.profileId, req.params.id]);
  if (!deleted.rows[0]) return res.status(404).json({ message: 'Perfil não encontrado.' });
  // Sessões usando esse perfil precisam ser revogadas — senão continuam
  // válidas com um perfil que acabou de ser removido até o access token
  // expirar (até 15 min).
  await query(`update refresh_tokens set revoked_at=now() where user_id=$1 and active_profile_id=$2 and revoked_at is null`, [req.params.id, req.params.profileId]);
  await logAudit(req, 'pessoas', 'updated', `Removeu um perfil adicional`, { entityId: req.params.id });
  return res.status(204).send();
}));

export default router;
