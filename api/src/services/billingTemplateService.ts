import { readFile } from 'fs/promises';
import { resolve } from 'path';
import JSZip from 'jszip';

type BillingExportItem = {
  payer_name: string | null;
  document: string;
  email: string | null;
  phone: string | null;
  street: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  amount_cents: number;
  due_date: string | Date;
  source_row: number | null;
};

type BillingTemplateData = {
  batchId: string;
  referenceMonth: string | Date | null;
  description: string | null;
  beneficiaryName: string | null;
  beneficiaryDocument: string | null;
  settings: {
    receive_boleto?: boolean;
    receive_pix?: boolean;
    allow_after_due?: boolean;
    days_after_due?: number;
    fine_type?: string;
    fine_value?: number;
    interest_type?: string;
    interest_value?: number;
    discount_type?: string;
    discount_value?: number;
    discount_days?: number;
  } | null;
  items: BillingExportItem[];
};

const TEMPLATE_PATH = resolve(process.cwd(), 'src', 'assets', 'Template_Cobrancas_Arquivo_Excel.xlsx');
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const xmlEscape = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const columnName = (index: number) => {
  let result = '';
  for (let value = index; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + ((value - 1) % 26)) + result;
  return result;
};

const replaceCell = (xml: string, address: string, value: string | number | null) => {
  // Match self-closing cells first. Otherwise `<c .../>` is consumed by the
  // regular-cell branch and its slash becomes an invalid XML attribute.
  const pattern = new RegExp(`<c([^>]*\\br="${address}"[^>]*?)\\s*\\/>|<c([^>]*\\br="${address}"[^>]*?)>(?:[\\s\\S]*?)<\\/c>`);
  return xml.replace(pattern, (_match, emptyAttributes, normalAttributes) => {
    const attributes = String(emptyAttributes || normalAttributes).replace(/\s+t="[^"]*"/g, '').trimEnd();
    if (value === null || value === '') return `<c${attributes}/>`;
    if (typeof value === 'number') return `<c${attributes}><v>${value}</v></c>`;
    return `<c${attributes} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  });
};

const interRule = (type: string | undefined, none: string, percent: string) =>
  type === 'FIXED' ? 'Real (R$)' : type === 'PERCENT' || type === 'PERCENT_MONTH' ? percent : none;

const excelDateNumber = (value: string | Date) => {
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = iso.split('-');
  return Number(`${day}${month}${year}`);
};

const referenceMonthCode = (value: string | Date | null) => {
  if (!value) return '';
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month] = iso.split('-');
  return year && month ? `${month}/${year}` : String(value);
};

export const createBillingTemplateWorkbook = async (data: BillingTemplateData) => {
  if (data.items.length > 1003) throw new Error('O template do Banco Inter comporta no máximo 1003 cobranças por arquivo.');
  const zip = await JSZip.loadAsync(await readFile(TEMPLATE_PATH));
  const worksheet = zip.file('xl/worksheets/sheet2.xml');
  if (!worksheet) throw new Error('A aba "Cobrança Simples" não foi encontrada no template.');
  let xml = await worksheet.async('string');
  const settings = data.settings || {};
  // The official example omits N4 entirely because its sample beneficiary is
  // "Não". Add the cell using the document-column style used from N5 onward.
  if (!/<c[^>]*\br="N4"/.test(xml)) xml = xml.replace('<c r="O4"', '<c r="N4" s="65"/><c r="O4"');

  data.items.forEach((item, index) => {
    const row = index + 4;
    const values: Array<string | number | null> = [
      item.payer_name, digits(item.document), item.email, digits(item.phone), item.street,
      item.address_number, item.address_complement, item.neighborhood, item.city, item.state,
      digits(item.postal_code), 'Sim', data.beneficiaryName, digits(data.beneficiaryDocument),
      settings.receive_pix === false ? 'Não' : 'Sim', settings.receive_boleto === false ? 'Outras formas de pagamento' : 'Boleto',
      Number(item.amount_cents) / 100, referenceMonthCode(data.referenceMonth),
      data.description || 'Taxa condominial', excelDateNumber(item.due_date), settings.allow_after_due === false ? 'Não' : 'Sim',
      Number(settings.days_after_due ?? 30), interRule(settings.fine_type, 'Não aplicar multa', 'Porcentagem (%)'), Number(settings.fine_value ?? 0),
      interRule(settings.interest_type, 'Não aplicar juros', 'Taxa (% a.m.)'), Number(settings.interest_value ?? 0),
      interRule(settings.discount_type, 'Não aplicar desconto', 'Porcentagem (%)'), Number(settings.discount_value ?? 0),
      Number(settings.discount_days ?? 0), 'Não', null, null, null, null, null, null, null,
    ];
    values.forEach((value, column) => { xml = replaceCell(xml, `${columnName(column + 1)}${row}`, value); });
  });

  zip.file('xl/worksheets/sheet2.xml', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};
