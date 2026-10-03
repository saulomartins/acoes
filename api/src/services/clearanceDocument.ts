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
  // Fora do hash: só escolhe entre "de titularidade de" (proprietário) e
  // "ocupada por" (inquilino) no texto.
  requesterRole?: string | null;
};

// Cargo como aparece no documento. "(a)" porque o texto é o mesmo para
// síndico e síndica.
const roleLabel: Record<string, string> = { sindico: 'Síndico(a)', subsindico: 'Subsíndico(a)' };

// Datas sempre no fuso do condomínio: o servidor roda em UTC, e uma emissão
// depois das 21h sairia com a data do dia seguinte.
const TIME_ZONE = 'America/Sao_Paulo';
const longDate = (date: Date) => date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
const shortDate = (date: Date) => date.toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });

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

const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#0f5e57';

export const buildClearancePdf = async (data: ClearanceDocumentData, verifyUrl: string): Promise<Buffer> => {
  const margin = 64;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: margin, left: margin, right: margin } });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const left = margin;
  const width = doc.page.width - margin * 2;

  // Cabeçalho do condomínio.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(data.condominiumName.toUpperCase(), { align: 'center' });
  doc.moveDown(0.3).fillColor(MUTED).font('Helvetica').fontSize(9.5);
  if (data.condominiumAddress) doc.text(data.condominiumAddress, { align: 'center' });
  if (data.condominiumCnpj) doc.text(`CNPJ nº ${data.condominiumCnpj}`, { align: 'center' });
  doc.moveDown(0.8);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(1.2).strokeColor(ACCENT).stroke();

  doc.moveDown(2.2);
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13.5)
    .text('DECLARAÇÃO DE QUITAÇÃO DE DÉBITOS CONDOMINIAIS', left, doc.y, { width, align: 'center', characterSpacing: 0.4 });
  doc.moveDown(2.2);

  const cargo = roleLabel[data.issuerRole] || data.issuerRole;
  const issued = data.issuedAt;
  const unit = data.unitLabel || '—';
  const holder = data.requesterRole === 'inquilino' ? 'ocupada por' : 'de titularidade de';
  const paragraph = { width, align: 'justify' as const, lineGap: 4.5, indent: 36, paragraphGap: 12 };

  doc.font('Helvetica').fontSize(11.5).fillColor(INK);
  doc.text(
    `${data.condominiumName}${data.condominiumCnpj ? `, inscrito no CNPJ sob o nº ${data.condominiumCnpj}` : ''}` +
    `${data.condominiumAddress ? `, situado na ${data.condominiumAddress}` : ''}, neste ato representado por seu(sua) ${cargo}, ` +
    `${data.issuerName}${data.issuerCpf ? `, portador(a) do CPF nº ${data.issuerCpf}` : ''}, DECLARA, para os devidos fins e a quem ` +
    `possa interessar, que a unidade ${unit}, ${holder} ${data.requesterName}${data.requesterCpf ? `, CPF nº ${data.requesterCpf}` : ''}, ` +
    `encontra-se integralmente quite com suas obrigações condominiais até a presente data.`,
    left, doc.y, paragraph,
  );
  doc.text(
    `Declara, ainda, que não existem débitos condominiais, ordinários ou extraordinários, multas, juros, encargos ou ` +
    `quaisquer outros valores exigíveis relacionados à referida unidade, relativamente ao período compreendido até ${shortDate(issued)}.`,
    paragraph,
  );
  doc.text(
    `A presente declaração é emitida a pedido do interessado, para que produza os efeitos legais e jurídicos pertinentes, ` +
    `inclusive perante terceiros, servindo como comprovante de quitação das obrigações condominiais relativas à unidade acima identificada.`,
    paragraph,
  );

  doc.moveDown(1.5);
  const city = cityFromAddress(data.condominiumAddress);
  doc.text(`${city ? `${city}, ` : ''}${longDate(issued)}.`, left, doc.y, { width, align: 'right' });

  // Assinatura.
  doc.moveDown(4.5);
  const lineWidth = 260;
  const lineX = left + (width - lineWidth) / 2;
  doc.moveTo(lineX, doc.y).lineTo(lineX + lineWidth, doc.y).lineWidth(0.8).strokeColor(INK).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11.5).text(data.issuerName.toUpperCase(), left, doc.y, { width, align: 'center' });
  doc.font('Helvetica').fontSize(10.5).text(`${cargo} – ${data.condominiumName.toUpperCase()}`, { width, align: 'center' });
  if (data.issuerCpf) doc.text(`CPF nº ${data.issuerCpf}`, { width, align: 'center' });

  // Rodapé de autenticidade — é isso que dá validade prática ao documento
  // sem certificado digital: qualquer um confere na página pública. Fica
  // preso ao pé da página; a margem inferior é zerada para o pdfkit não
  // abrir uma segunda página ao escrever ali.
  const boxHeight = 62;
  const boxY = doc.page.height - margin + 8 - boxHeight;
  doc.page.margins.bottom = 0;
  doc.roundedRect(left, boxY, width, boxHeight, 6).fillColor('#f3f6f6').fill();
  doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
    .text('Documento emitido eletronicamente pelo sistema Lar em Dia.', left + 12, boxY + 10, { width: width - 24, align: 'center' });
  doc.fillColor(INK).font('Helvetica-Bold').text(`Código verificador: ${data.verificationCode}`, { width: width - 24, align: 'center' });
  doc.fillColor(MUTED).font('Helvetica').text(`Confira a autenticidade em ${verifyUrl}`, { width: width - 24, align: 'center' });
  doc.text(`Emitido em ${issued.toLocaleString('pt-BR', { timeZone: TIME_ZONE })} · SHA-256: ${hashDocument(data).slice(0, 32)}...`, { width: width - 24, align: 'center' });

  doc.end();
  return done;
};
