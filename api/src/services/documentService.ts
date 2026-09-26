// CPF/CNPJ do campo users.cpf — que guarda os dois (síndico profissional e
// administradora têm CNPJ). Desde julho de 2026 a Receita emite CNPJ
// alfanumérico: 12 posições com letras maiúsculas ou números + 2 dígitos
// verificadores sempre numéricos (ex.: 12.ABC.345/01DE-35). O CNPJ só com
// números continua válido pra sempre — a regra nova é um superconjunto da
// antiga, então os dois formatos passam pelo mesmo cálculo abaixo.

// Tira máscara e espaços e põe letras em maiúsculas: "12.abc.345/01de-35"
// vira "12ABC34501DE35". Nunca descarta letras — antes descartava, e um CNPJ
// alfanumérico virava um número qualquer de 8 dígitos.
export const normalizeDocument = (raw?: string | null): string =>
  String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

// Formato aceito no cadastro: CPF com 11 dígitos ou CNPJ com 14 posições
// (12 alfanuméricas + 2 dígitos). Só o formato — o dígito verificador não é
// exigido no cadastro pra não travar a edição de cadastros antigos; quem
// precisa de documento verificado (cobrança Pix) usa identifyDocument.
export const isAcceptedDocumentFormat = (normalized: string): boolean =>
  /^\d{11}$/.test(normalized) || /^[0-9A-Z]{12}\d{2}$/.test(normalized);

// Valida o dígito verificador de verdade, não só a quantidade de dígitos —
// confirmado testando contra a API real do Mercado Pago: um número do tamanho
// certo mas com dígito verificador inválido também faz o pagamento ser
// recusado com "processing_error". Repetidos (000..., 111...) nunca são
// válidos e nem passam pelo cálculo.
export const isValidCpf = (digits: string): boolean => {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(digits[i]) * (len + 1 - i);
    const result = (sum * 10) % 11;
    return result === 10 ? 0 : result;
  };
  return calc(9) === Number(digits[9]) && calc(10) === Number(digits[10]);
};

// Regra oficial da Receita pro CNPJ alfanumérico: cada posição vale o código
// ASCII menos 48 ('0'..'9' → 0..9, 'A' → 17 ... 'Z' → 42), com os mesmos
// pesos e módulo 11 de sempre — pra um CNPJ só de números dá exatamente o
// cálculo antigo.
export const isValidCnpj = (value: string): boolean => {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
  const calc = (len: number) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      sum += (value.charCodeAt(len - i) - 48) * pos--;
      if (pos < 2) pos = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  return calc(12) === Number(value[12]) && calc(13) === Number(value[13]);
};

export const isAlphanumericCnpj = (normalized: string): boolean => /[A-Z]/.test(normalized);

// CPF ou CNPJ com dígito verificador conferido; qualquer outra coisa é null.
export const identifyDocument = (raw?: string | null): { type: 'CPF' | 'CNPJ'; number: string } | null => {
  const normalized = normalizeDocument(raw);
  if (isValidCpf(normalized)) return { type: 'CPF', number: normalized };
  if (isValidCnpj(normalized)) return { type: 'CNPJ', number: normalized };
  return null;
};

// Máscara LGPD pra exposição fora do sistema (planilha exportada): só as
// pontas do documento, o suficiente pra conferência visual.
export const maskDocument = (raw: string | null): string => {
  const normalized = normalizeDocument(raw);
  if (/^\d{11}$/.test(normalized)) return `${normalized.slice(0, 3)}.***.***-${normalized.slice(9)}`;
  if (normalized.length === 14) return `${normalized.slice(0, 2)}.***.***/****-${normalized.slice(12)}`;
  return 'Não informado';
};
