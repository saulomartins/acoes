import { query } from '../db';

// Regras da senha que a PRÓPRIA pessoa cria (primeiro acesso, troca, link de
// redefinição). Até 12/11/2026 só havia o mínimo de 8 caracteres, e a senha
// inicial era calculada a partir do CPF/unidade — por isso aqui também se
// recusa senha montada com esses dados, que qualquer vizinho conhece.
export type PasswordContext = { username: string; cpf: string | null; unitNumber: string | null; email: string | null };

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '12121212',
  'senha123', 'senha1234', 'password', 'password1', 'qwerty123', 'abc12345', 'mudar123', 'trocar123',
  'condominio', 'condominio1', 'laremdia', 'laremdia1', 'brasil123', 'admin123',
]);

const isSequence = (value: string) => {
  if (value.length < 6) return false;
  const codes = [...value].map(char => char.charCodeAt(0));
  const step = codes[1] - codes[0];
  return Math.abs(step) === 1 && codes.every((code, index) => index === 0 || code - codes[index - 1] === step);
};

export const passwordPolicyError = (password: string, context: PasswordContext | null): string | null => {
  if (password.length < 8) return 'A nova senha deve ter pelo menos 8 caracteres.';
  if (password.length > 128) return 'A nova senha pode ter no máximo 128 caracteres.';
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return 'A senha não pode ser um único caractere repetido.';
  if (COMMON.has(lower) || isSequence(lower)) return 'Esta senha é muito comum. Escolha outra mais difícil de adivinhar.';
  if (!context) return null;

  const digits = password.replace(/\D/g, '');
  const cpf = (context.cpf || '').replace(/\D/g, '');
  if (cpf.length >= 6) {
    for (let start = 0; start + 6 <= cpf.length; start += 1) {
      if (digits.includes(cpf.slice(start, start + 6))) return 'Não use números do seu CPF na senha.';
    }
  }
  const unitDigits = (context.unitNumber || '').replace(/\D/g, '');
  // Mesma montagem da antiga senha inicial (apartamento + início do CPF).
  if (unitDigits && cpf.length >= 4 && digits.includes(`${unitDigits}${cpf.slice(0, 4)}`)) return 'Não use o número do apartamento com o seu CPF na senha.';
  const username = context.username.trim().toLowerCase();
  if (username.length >= 4 && lower.includes(username)) return 'Não use o seu usuário de acesso na senha.';
  const emailUser = (context.email || '').split('@')[0].trim().toLowerCase();
  if (emailUser.length >= 4 && lower.includes(emailUser)) return 'Não use o seu e-mail na senha.';
  return null;
};

export const loadPasswordContext = async (userId: string): Promise<PasswordContext | null> => {
  const result = await query<{ username: string; cpf: string | null; unit_number: string | null; email: string | null }>(
    `select u.username, u.cpf, coalesce(un.number, u.unit) unit_number, u.email
     from users u left join units un on un.id=u.unit_id where u.id=$1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? { username: row.username, cpf: row.cpf, unitNumber: row.unit_number, email: row.email } : null;
};
