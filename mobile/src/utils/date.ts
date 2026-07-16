const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

export const maskBrazilianDate = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean).join('/');
};

export const brazilianDateToIso = (value: string): string | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
};

export const formatBrazilianDate = (value?: string | Date | null) => {
  if (!value) return '';
  if (typeof value === 'string') {
    const dateOnly = DATE_ONLY.exec(value);
    if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-BR');
};

export const maskBrazilianMonth = (value: string) => {
  const digits = value.replace(/\D/g, '').slice(0, 6);
  return [digits.slice(0, 2), digits.slice(2, 6)].filter(Boolean).join('/');
};

export const brazilianMonthToIso = (value: string): string | null => {
  const match = /^(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12) return null;
  return `${match[2]}-${match[1]}`;
};

export const formatBrazilianMonth = (value?: string | null) => {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[1]}` : value;
};
