import { describe, expect, it } from 'vitest';
import {
  identifyDocument,
  isAcceptedDocumentFormat,
  isAlphanumericCnpj,
  isValidCnpj,
  isValidCpf,
  maskDocument,
  normalizeDocument,
} from './documentService';

// Documentos de exemplo públicos (geradores/documentação), nenhum de pessoa real.
const VALID_CPFS = ['52998224725', '11144477735', '39053344705'];
const VALID_NUMERIC_CNPJS = ['11222333000181', '11444777000161', '45997418000153'];
// 12ABC34501DE35 é o exemplo da própria Receita Federal para o CNPJ alfanumérico.
const VALID_ALPHANUMERIC_CNPJ = '12ABC34501DE35';

const bumpLastDigit = (value: string) => value.slice(0, -1) + ((Number(value.at(-1)) + 1) % 10);
const everyCheckDigitPair = (base: string) => Array.from({ length: 100 }, (_, n) => base + String(n).padStart(2, '0'));

describe('normalizeDocument', () => {
  it('tira máscara e espaços', () => {
    expect(normalizeDocument('529.982.247-25')).toBe('52998224725');
    expect(normalizeDocument(' 11.222.333/0001-81 ')).toBe('11222333000181');
  });

  it('mantém letras (em maiúsculas) do CNPJ alfanumérico', () => {
    expect(normalizeDocument('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  });

  it('vazio para null/undefined', () => {
    expect(normalizeDocument(null)).toBe('');
    expect(normalizeDocument(undefined)).toBe('');
  });
});

describe('isValidCpf', () => {
  it.each(VALID_CPFS)('aceita CPF válido %s', (cpf) => {
    expect(isValidCpf(cpf)).toBe(true);
  });

  it.each(VALID_CPFS)('recusa %s com o último dígito verificador trocado', (cpf) => {
    expect(isValidCpf(bumpLastDigit(cpf))).toBe(false);
  });

  it('recusa CPF com o primeiro dígito verificador trocado', () => {
    expect(isValidCpf('52998224735')).toBe(false);
  });

  it('recusa sequências repetidas, mesmo que passem na conta', () => {
    for (let d = 0; d <= 9; d++) expect(isValidCpf(String(d).repeat(11))).toBe(false);
  });

  it('recusa tamanho errado, máscara e letras', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247250')).toBe(false);
    expect(isValidCpf('')).toBe(false);
    expect(isValidCpf('529.982.247-25')).toBe(false);
    expect(isValidCpf('5299822A725')).toBe(false);
  });

  it('para cada base de 9 dígitos existe exatamente um par de verificadores válido', () => {
    for (const base of ['123456789', '987654321', '000000001', '529982247', '100000000', '314159265']) {
      expect(everyCheckDigitPair(base).filter(isValidCpf)).toHaveLength(1);
    }
  });
});

describe('isValidCnpj — só números (formato antigo, continua valendo)', () => {
  it.each(VALID_NUMERIC_CNPJS)('aceita CNPJ válido %s', (cnpj) => {
    expect(isValidCnpj(cnpj)).toBe(true);
  });

  it.each(VALID_NUMERIC_CNPJS)('recusa %s com o último dígito verificador trocado', (cnpj) => {
    expect(isValidCnpj(bumpLastDigit(cnpj))).toBe(false);
  });

  it('recusa CNPJ com o primeiro dígito verificador trocado', () => {
    expect(isValidCnpj('11222333000191')).toBe(false);
  });

  it('recusa sequências repetidas', () => {
    for (let d = 0; d <= 9; d++) expect(isValidCnpj(String(d).repeat(14))).toBe(false);
  });

  it('recusa tamanho errado', () => {
    expect(isValidCnpj('1122233300018')).toBe(false);
    expect(isValidCnpj('112223330001810')).toBe(false);
  });

  it('para cada base de 12 dígitos existe exatamente um par de verificadores válido', () => {
    for (const base of ['112223330001', '123456780001', '000000010001', '999999990001']) {
      expect(everyCheckDigitPair(base).filter(isValidCnpj)).toHaveLength(1);
    }
  });

  it('CPF válido nunca é aceito como CNPJ e vice-versa', () => {
    for (const cpf of VALID_CPFS) expect(isValidCnpj(cpf)).toBe(false);
    for (const cnpj of VALID_NUMERIC_CNPJS) expect(isValidCpf(cnpj)).toBe(false);
  });
});

describe('isValidCnpj — alfanumérico (Receita, desde julho de 2026)', () => {
  it('aceita o exemplo oficial da Receita', () => {
    expect(isValidCnpj(VALID_ALPHANUMERIC_CNPJ)).toBe(true);
  });

  it('recusa com qualquer um dos dígitos verificadores trocado', () => {
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
    expect(isValidCnpj('12ABC34501DE45')).toBe(false);
  });

  it('trocar uma letra da base invalida o documento (letras entram na conta)', () => {
    expect(isValidCnpj('12ABD34501DE35')).toBe(false);
  });

  it('dígitos verificadores são sempre numéricos: letra no fim é recusada', () => {
    expect(isValidCnpj('12ABC34501DE3A')).toBe(false);
  });

  it('só aceita letras maiúsculas (normalizeDocument cuida disso antes)', () => {
    expect(isValidCnpj('12abc34501de35')).toBe(false);
    expect(isValidCnpj(normalizeDocument('12abc34501de35'))).toBe(true);
  });

  it('para cada base alfanumérica existe exatamente um par de verificadores válido', () => {
    for (const base of ['12ABC34501DE', 'ZZZZZZZZZZZZ', 'A1B2C3D4E5F6', '00000000000A']) {
      expect(everyCheckDigitPair(base).filter(isValidCnpj)).toHaveLength(1);
    }
  });
});

describe('isAcceptedDocumentFormat (cadastro)', () => {
  it('aceita CPF, CNPJ numérico e CNPJ alfanumérico', () => {
    expect(isAcceptedDocumentFormat('52998224725')).toBe(true);
    expect(isAcceptedDocumentFormat('11222333000181')).toBe(true);
    expect(isAcceptedDocumentFormat(VALID_ALPHANUMERIC_CNPJ)).toBe(true);
  });

  it('só confere o formato, não o dígito verificador (cadastros antigos seguem editáveis)', () => {
    expect(isAcceptedDocumentFormat('52998224726')).toBe(true);
  });

  it('recusa tamanho errado, letra em CPF e letra nos dígitos verificadores', () => {
    expect(isAcceptedDocumentFormat('1234567890')).toBe(false);
    expect(isAcceptedDocumentFormat('123456789012')).toBe(false);
    expect(isAcceptedDocumentFormat('5299822472A')).toBe(false);
    expect(isAcceptedDocumentFormat('12ABC34501DEAB')).toBe(false);
  });
});

describe('identifyDocument', () => {
  it('detecta CPF e tira a máscara', () => {
    expect(identifyDocument('529.982.247-25')).toEqual({ type: 'CPF', number: '52998224725' });
  });

  it('detecta CNPJ numérico e tira a máscara', () => {
    expect(identifyDocument('11.222.333/0001-81')).toEqual({ type: 'CNPJ', number: '11222333000181' });
  });

  it('detecta CNPJ alfanumérico, com máscara e em minúsculas', () => {
    expect(identifyDocument('12.abc.345/01de-35')).toEqual({ type: 'CNPJ', number: '12ABC34501DE35' });
  });

  it('omite documento ausente, sujo ou com dígito verificador errado', () => {
    for (const bad of [null, undefined, '', '123', '529.982.247-26', '11.222.333/0001-82', '000.000.000-00', '12.ABC.345/01DE-36']) {
      expect(identifyDocument(bad)).toBeNull();
    }
  });
});

describe('isAlphanumericCnpj', () => {
  it('diferencia os dois formatos de CNPJ', () => {
    expect(isAlphanumericCnpj(VALID_ALPHANUMERIC_CNPJ)).toBe(true);
    expect(isAlphanumericCnpj('11222333000181')).toBe(false);
    expect(isAlphanumericCnpj('52998224725')).toBe(false);
  });
});

describe('maskDocument (planilha exportada, LGPD)', () => {
  it('mostra só as pontas dos três formatos', () => {
    expect(maskDocument('52998224725')).toBe('529.***.***-25');
    expect(maskDocument('11222333000181')).toBe('11.***.***/****-81');
    expect(maskDocument('12ABC34501DE35')).toBe('12.***.***/****-35');
  });

  it('documento ausente ou fora do formato vira "Não informado"', () => {
    expect(maskDocument(null)).toBe('Não informado');
    expect(maskDocument('123')).toBe('Não informado');
  });
});
