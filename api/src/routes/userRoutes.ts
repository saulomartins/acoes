import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { query } from '../db';
import type { UserRole } from '../types';

const router = Router();
const validRoles: UserRole[] = ['admin_geral', 'sindico', 'subsindico', 'proprietario', 'inquilino'];
const managerCreatedRoles: UserRole[] = ['subsindico', 'proprietario', 'inquilino'];

router.use(authenticate);

router.get('/', asyncHandler(async (req, res) => {
  const condominiumId = req.user?.role === 'admin_geral' ? req.query.condominiumId : req.user?.condominiumId;

  const result = await query(
    `select users.id, users.username, users.full_name, users.cpf, users.email, users.phone, users.role,
            users.condominium_id, users.unit_id, coalesce(blocks.name || ' / ' || units.number, users.unit) as unit, units.unit_type_id, users.billing_exempt, users.preferred_due_day, users.created_at,
            users.street, users.address_number, users.address_complement, users.neighborhood, users.city, users.state, users.postal_code,
            unit_types.name as unit_type_name, unit_types.fee_cents as condominium_fee_cents,
            exists(select 1 from unit_occupancies uo where uo.user_id=users.id and uo.unit_id=users.unit_id and uo.ended_at is null and uo.is_representative=true) as is_unit_representative
     from users
     left join units on units.id = users.unit_id
     left join blocks on blocks.id = units.block_id
     left join unit_types on unit_types.id = units.unit_type_id
     where ($1::uuid is null or users.condominium_id = $1)
       and ($2::boolean = false or users.role in ('sindico','subsindico'))
     order by users.created_at desc`,
    [condominiumId || null, req.user?.role === 'admin_geral'],
  );

  return res.json({ users: result.rows });
}));

router.post('/', authorize('admin_geral', 'sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const { username, password, role, condominiumId, fullName, cpf, email, phone, unitId, isRepresentative, billingExempt, preferredDueDay,
    street, addressNumber, addressComplement, neighborhood, city, state, postalCode } = req.body ?? {};

  if (!username || !password || !role || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'username, password and role are required' });
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

  const existingUsername = await query(`select id from users where lower(username) = $1`, [normalizedUsername]);
  if (existingUsername.rows[0]) {
    return res.status(409).json({ message: 'Usuário de acesso já cadastrado. Escolha outro nome de usuário.' });
  }

  if (cpfDigits && unitId) {
    const existingCpf = await query(`select id from users where regexp_replace(coalesce(cpf, ''), '[^0-9]', '', 'g') = $1 and unit_id=$2`, [cpfDigits, unitId]);
    if (existingCpf.rows[0]) {
      return res.status(409).json({ message: 'CPF já cadastrado para outra pessoa.' });
    }
  }

  if ((role === 'proprietario' || role === 'inquilino') && !unitId) {
    return res.status(400).json({ message: 'Selecione a unidade do morador.' });
  }
  const selectedUnit = unitId ? await query<{id:string;number:string;unit_type_id:string|null}>(`select id,number,unit_type_id from units where id=$1 and condominium_id=$2 and active=true`,[unitId,targetCondominiumId]) : null;
  if (unitId && !selectedUnit?.rows[0]) return res.status(400).json({ message:'Unidade inválida para o condomínio.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await query(
    `insert into users (id, username, password_hash, role, condominium_id, full_name, cpf, email, phone, unit, unit_id, billing_exempt, preferred_due_day,
       street, address_number, address_complement, neighborhood, city, state, postal_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
     returning id, username, full_name, cpf, email, phone, role, condominium_id, unit, unit_id, billing_exempt, preferred_due_day, created_at`,
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
      street || null, addressNumber || null, addressComplement || null, neighborhood || null,
      city || null, state ? String(state).trim().toUpperCase() : null,
      postalCode ? String(postalCode).replace(/\D/g, '') : null,
    ],
  );

  if (unitId && (role === 'proprietario' || role === 'inquilino')) {
    if (isRepresentative) await query(`update unit_occupancies set is_representative=false where unit_id=$1 and ended_at is null`,[unitId]);
    await query(`insert into unit_occupancies(unit_id,user_id,is_representative) values($1,$2,$3)`,[unitId,(result.rows[0] as any).id,Boolean(isRepresentative)]);
  }

  return res.status(201).json({ user: result.rows[0] });
}));

router.patch('/:id', authorize('admin_geral', 'sindico', 'subsindico'), asyncHandler(async (req, res) => {
  const { username, password, role, condominiumId, fullName, cpf, email, phone, unitId, isRepresentative, billingExempt, preferredDueDay,
    street, addressNumber, addressComplement, neighborhood, city, state, postalCode } = req.body ?? {};
  const current = await query<{ id: string; role: UserRole; condominium_id: string | null; unit_id:string|null }>(
    `select id, role, condominium_id, unit_id from users where id = $1`, [req.params.id],
  );
  const target = current.rows[0];
  if (!target) return res.status(404).json({ message: 'Usuário não encontrado.' });

  if (req.user?.role === 'admin_geral' && target.role !== 'sindico' && target.role !== 'subsindico') {
    return res.status(403).json({ message: 'Administrador geral pode editar somente síndicos e subsíndicos.' });
  }
  if (req.user?.role !== 'admin_geral' && target.condominium_id !== req.user?.condominiumId) {
    return res.status(403).json({ message: 'Usuário não pertence ao seu condomínio.' });
  }

  const nextRole = (role || target.role) as UserRole;
  if (req.user?.role === 'admin_geral' && nextRole !== 'sindico' && nextRole !== 'subsindico') {
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

  const usernameConflict = await query(`select id from users where lower(username) = $1 and id <> $2`, [normalizedUsername, req.params.id]);
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

  const passwordHash = password ? await bcrypt.hash(String(password), 10) : null;
  const result = await query(
    `update users set username = $1, password_hash = coalesce($2, password_hash), role = $3,
       condominium_id = $4, full_name = $5, cpf = $6, email = $7, phone = $8, unit = $9, unit_id=$10, unit_type_id = null, billing_exempt=$11, preferred_due_day=$12,
       street = $13, address_number = $14, address_complement = $15, neighborhood = $16,
       city = $17, state = $18, postal_code = $19
     where id = $20
     returning id, username, full_name, cpf, email, phone, role, condominium_id, unit, unit_id, billing_exempt, preferred_due_day, created_at`,
    [normalizedUsername, passwordHash, nextRole, targetCondominiumId, fullName || null, cpfDigits, email || null, phoneDigits,
      selectedUnit?.rows[0]?.number || null, unitId || null, Boolean(billingExempt), Number(preferredDueDay) === 20 ? 20 : 10, street || null, addressNumber || null, addressComplement || null,
      neighborhood || null, city || null, state ? String(state).trim().toUpperCase() : null,
      postalCode ? String(postalCode).replace(/\D/g, '') : null, req.params.id],
  );
  if (target.unit_id && target.unit_id !== unitId) await query(`update unit_occupancies set ended_at=current_date,is_representative=false where unit_id=$1 and user_id=$2 and ended_at is null`,[target.unit_id,req.params.id]);
  if (unitId && (nextRole === 'proprietario' || nextRole === 'inquilino')) {
    if (isRepresentative) await query(`update unit_occupancies set is_representative=false where unit_id=$1 and ended_at is null`,[unitId]);
    await query(`insert into unit_occupancies(unit_id,user_id,is_representative) values($1,$2,$3) on conflict (unit_id,user_id) where ended_at is null do update set is_representative=excluded.is_representative`,[unitId,req.params.id,Boolean(isRepresentative)]);
  }
  return res.json({ user: result.rows[0] });
}));

export default router;
