import PDFDocument from 'pdfkit';
import { createHash, randomBytes } from 'crypto';

export type ClearanceDocumentData = {
  condominiumName: string;
  condominiumAddress: string | null;
  condominiumCnpj: string | null;
  issuerName: string;
  issuerCpf: string | null;
  issuerRole: string;
  requesterName: string;
  requesterCpf: string | null;
  unitLabel: string | null;
  issuedAt: Date;
  verificationCode: string;
};

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const roleLabel: Record<string, string> = { sindico: 'síndico', subsindico: 'subsíndico' };

// Código curto e legível pra digitar no site de verificação (sem O/0/I/1).
export const generateVerificationCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const code = [...bytes].map(byte => alphabet[byte % alphabet.length]).join('');
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
};

// Hash do conteúdo declarado: permite provar que um PDF que circule por aí
// não teve nome, unidade ou data alterados depois de emitido.
export const hashDocument = (data: ClearanceDocumentData) => createHash('sha256').update([
  data.condominiumName, data.condominiumCnpj || '', data.issuerName, data.issuerCpf || '',
  data.requesterName, data.requesterCpf || '', data.unitLabel || '',
  data.issuedAt.toISOString().slice(0, 10), data.verificationCode,
].join('|')).digest('hex');

// A cidade sai do fim do endereço do condomínio (padrão "... , Cidade - UF").
const cityFromAddress = (address: string | null) => {
  if (!address) return '';
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  return last.split('-')[0].trim();
};

export const buildClearancePdf = async (data: ClearanceDocumentData, verifyUrl: string): Promise<Buffer> => {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 64, bottom: 64, left: 64, right: 64 } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.font('Helvetica-Bold').fontSize(13).text(data.condominiumName.toUpperCase(), { align: 'center' });
  doc.font('Helvetica').fontSize(10);
  if (data.condominiumAddress) doc.text(data.condominiumAddress, { align: 'center' });
  if (data.condominiumCnpj) doc.text(`CNPJ: ${data.condominiumCnpj}`, { align: 'center' });

  doc.moveDown(2.5);
  doc.font('Helvetica-Bold').fontSize(13).text('DECLARAÇÃO DE QUITAÇÃO CONDOMINIAL', { align: 'center' });
  doc.moveDown(2.5);

  const cargo = roleLabel[data.issuerRole] || data.issuerRole;
  doc.font('Helvetica').fontSize(11.5).text(
    `Eu, ${data.issuerName}, inscrito no CPF ${data.issuerCpf || '—'}, ${cargo} do ${data.condominiumName}` +
    `${data.condominiumAddress ? `, situado na ${data.condominiumAddress}` : ''}, eleito pela Assembleia geral dos condôminos, ` +
    `declaro sob as penas da Lei que a unidade ${data.unitLabel || '—'}, sob posse de ${data.requesterName}, ` +
    `inscrito no CPF ${data.requesterCpf || '—'}, se encontra com seus pagamentos em dia, com relação a débitos ` +
    `anteriores à data de hoje, não havendo litígios de qualquer pendência de cobrança em nosso poder, ` +
    `atinente às despesas de Condomínio.`,
    { align: 'justify', lineGap: 4, indent: 28 },
  );

  doc.moveDown(4);
  const city = cityFromAddress(data.condominiumAddress);
  const issued = data.issuedAt;
  doc.text(`${city ? `${city}, ` : ''}${issued.getDate()} de ${MONTHS[issued.getMonth()]} de ${issued.getFullYear()}`, { align: 'center' });

  doc.moveDown(4);
  doc.fontSize(10).text('Assinado por:', { align: 'center' });
  doc.font('Helvetica-Bold').fontSize(11.5).text(data.issuerName, { align: 'center' });
  doc.font('Helvetica').fontSize(10).text(`${cargo.charAt(0).toUpperCase()}${cargo.slice(1)}`, { align: 'center' });

  // Rodapé de autenticidade — é isso que dá validade prática ao documento
  // sem certificado digital: qualquer um confere na página pública.
  doc.moveDown(4);
  doc.fontSize(8.5).fillColor('#444');
  doc.text('Documento emitido eletronicamente pelo sistema Lar em Dia.', { align: 'center' });
  doc.font('Helvetica-Bold').text(`Código verificador: ${data.verificationCode}`, { align: 'center' });
  doc.font('Helvetica').text(`Confira a autenticidade em ${verifyUrl}`, { align: 'center' });
  doc.text(`Emitido em ${issued.toLocaleString('pt-BR')} · SHA-256: ${hashDocument(data).slice(0, 32)}...`, { align: 'center' });

  doc.end();
  return done;
};
