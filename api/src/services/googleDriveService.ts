import { Readable } from 'stream';
import { google, drive_v3 } from 'googleapis';
import { config } from '../config';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

let cachedClient: drive_v3.Drive | null = null;

const getDriveClient = (): drive_v3.Drive => {
  if (cachedClient) return cachedClient;
  if (!config.googleDrive.clientId || !config.googleDrive.clientSecret || !config.googleDrive.refreshToken) {
    throw new Error('Integração com o Google Drive não configurada (variáveis GOOGLE_DRIVE_* ausentes).');
  }
  const auth = new google.auth.OAuth2(config.googleDrive.clientId, config.googleDrive.clientSecret);
  auth.setCredentials({ refresh_token: config.googleDrive.refreshToken });
  cachedClient = google.drive({ version: 'v3', auth });
  return cachedClient;
};

export const isGoogleDriveConfigured = () =>
  Boolean(config.googleDrive.clientId && config.googleDrive.clientSecret && config.googleDrive.refreshToken);

export const extractDriveFolderId = (input: string): string => {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch) return queryMatch[1];
  return trimmed;
};

export const getDriveFolderMeta = async (folderId: string) => {
  const drive = getDriveClient();
  const response = await drive.files.get({
    fileId: folderId,
    fields: 'id, name, mimeType, trashed',
    supportsAllDrives: true,
  });
  if (response.data.mimeType !== FOLDER_MIME_TYPE) throw new Error('O ID informado não corresponde a uma pasta do Google Drive.');
  if (response.data.trashed) throw new Error('Essa pasta do Google Drive está na lixeira.');
  return response.data;
};

const monthLabel = (referenceMonth: string) => {
  const match = String(referenceMonth || '').match(/^(\d{4})-(\d{2})/);
  if (!match) throw new Error('Mês de referência inválido para organizar a pasta no Drive.');
  return `${match[1]}-${match[2]}`;
};

export const findOrCreateMonthFolder = async (rootFolderId: string, referenceMonth: string): Promise<string> => {
  const drive = getDriveClient();
  const name = monthLabel(referenceMonth);
  const escapedName = name.replace(/'/g, "\\'");
  const existing = await drive.files.list({
    q: `'${rootFolderId}' in parents and name='${escapedName}' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const found = existing.data.files?.[0];
  if (found?.id) return found.id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME_TYPE, parents: [rootFolderId] },
    fields: 'id',
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error('Falha ao criar a subpasta do mês no Google Drive.');
  return created.data.id;
};

export const uploadDriveFile = async (folderId: string, fileName: string, mimeType: string, buffer: Buffer): Promise<string> => {
  const drive = getDriveClient();
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error('Falha ao enviar o arquivo para o Google Drive.');
  return created.data.id;
};

export const downloadDriveFile = async (fileId: string): Promise<Buffer> => {
  const drive = getDriveClient();
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(response.data as ArrayBuffer);
};

export const deleteDriveFile = async (fileId: string): Promise<void> => {
  try {
    const drive = getDriveClient();
    await drive.files.delete({ fileId, supportsAllDrives: true });
  } catch {
    // Melhor esforço: se o arquivo já não existir ou o Drive falhar, não
    // bloqueia a operação principal (upload de substituição ou exclusão).
  }
};
