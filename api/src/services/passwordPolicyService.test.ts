import { describe, expect, it } from 'vitest';
import { passwordPolicyError } from './passwordPolicyService';
import { generateTemporaryPassword } from './credentialService';

const patricia = { username: 'patricia', cpf: '123.456.789-01', unitNumber: 'APTO-408', email: 'patricia.nasc@gmail.com' };

describe('passwordPolicyError — senha criada pela própria pessoa', () => {
  it('aceita senha razoável', () => {
    expect(passwordPolicyError('Girassol-azul-27', patricia)).toBeNull();
    expect(passwordPolicyError('casa da praia 2026', patricia)).toBeNull();
  });

  it('mínimo de 8 caracteres, como antes', () => {
    expect(passwordPolicyError('Ab3$xyz', patricia)).toMatch(/8 caracteres/);
  });

  it('recusa as senhas mais comuns, sequências e caractere repetido', () => {
    for (const weak of ['12345678', 'senha123', 'Password', 'abcdefgh', '87654321', 'aaaaaaaa']) {
      expect(passwordPolicyError(weak, patricia)).not.toBeNull();
    }
  });

  it('recusa números do CPF (6 seguidos, em qualquer posição) e a montagem antiga apto + CPF', () => {
    expect(passwordPolicyError('cpf123456!', patricia)).toMatch(/CPF/);
    expect(passwordPolicyError('x-567890-y', patricia)).toMatch(/CPF/);
    expect(passwordPolicyError('4081234ab', patricia)).toMatch(/apartamento/);
  });

  it('recusa usuário de acesso e o nome do e-mail', () => {
    expect(passwordPolicyError('Patricia2026', patricia)).toMatch(/usuário/);
    expect(passwordPolicyError('x patricia.nasc x', patricia)).not.toBeNull();
  });

  it('sem contexto (cadastro não encontrado) aplica só as regras gerais', () => {
    expect(passwordPolicyError('Girassol-azul-27', null)).toBeNull();
    expect(passwordPolicyError('12345678', null)).not.toBeNull();
  });
});

describe('generateTemporaryPassword', () => {
  it('formato XXX-XXX-XXX sem caracteres ambíguos (0/O, 1/I/L)', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = generateTemporaryPassword();
      expect(value).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}-[A-Z2-9]{3}$/);
      expect(value).not.toMatch(/[01OIL]/);
    }
  });

  it('não se repete (aleatória, não derivada do cadastro)', () => {
    const values = new Set(Array.from({ length: 500 }, generateTemporaryPassword));
    expect(values.size).toBe(500);
  });

  it('passa na própria regra de senha (o gestor nunca recebe uma senha "fraca")', () => {
    for (let i = 0; i < 50; i += 1) expect(passwordPolicyError(generateTemporaryPassword(), patricia)).toBeNull();
  });
});
