import 'dotenv/config';
import { createServer } from 'http';
import { URL } from 'url';
import { google } from 'googleapis';

// Autorização única da conta laremdia.condominio@gmail.com para acesso ao
// Google Drive. Abre o navegador, aguarda o login/consentimento, troca o
// código pelo refresh token e grava GOOGLE_DRIVE_REFRESH_TOKEN no .env.
// Rodar de novo só se o acesso for revogado manualmente na conta Google.

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const main = async () => {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Defina GOOGLE_DRIVE_CLIENT_ID e GOOGLE_DRIVE_CLIENT_SECRET no .env antes de rodar este script.');

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive'],
  });

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== '/oauth2callback') return;
      const authCode = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (error || !authCode) {
        res.end('<h1>Falha na autorização.</h1><p>Pode fechar esta aba e conferir o terminal.</p>');
        server.close();
        return reject(new Error(error || 'Código de autorização não recebido.'));
      }
      res.end('<h1>Autorização concluída.</h1><p>Pode fechar esta aba e voltar ao terminal.</p>');
      server.close();
      resolve(authCode);
    });
    server.listen(PORT, () => {
      console.log('Abra esta URL no navegador e faça login como laremdia.condominio@gmail.com:\n');
      console.log(authUrl);
      console.log(`\nAguardando o redirecionamento em ${REDIRECT_URI} ...`);
    });
  });

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('Nenhum refresh_token retornado. Revogue o acesso do app em myaccount.google.com/permissions e rode este script de novo (o parâmetro prompt=consent deveria forçar um novo refresh_token).');
  }

  console.log('\nAutorização concluída. Refresh token obtido com sucesso.');

  const fs = await import('fs');
  const path = await import('path');
  const envPath = path.resolve(__dirname, '../../.env');
  const current = fs.readFileSync(envPath, 'utf8');
  const line = `GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`;
  const updated = /^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m.test(current)
    ? current.replace(/^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m, line)
    : `${current.trimEnd()}\n${line}\n`;
  fs.writeFileSync(envPath, updated);
  console.log(`GOOGLE_DRIVE_REFRESH_TOKEN gravado em ${envPath}.`);
};

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
