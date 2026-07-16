# Publicação econômica

## 1. API e PostgreSQL no Railway

Crie um projeto, adicione PostgreSQL e um serviço apontando para `externals/api`.
O arquivo `railway.json` já contém build, start e healthcheck. Copie as variáveis de
`api/.env.example` para o Railway, usando valores secretos de produção.

Depois do primeiro deploy, execute uma vez no serviço da API:

```bash
npm run db:setup
```

Monte um volume em `/data` para os certificados bancários. Nunca envie certificados,
chaves ou arquivos `.env` ao repositório.

## 2. E-mail no Resend

Adicione seu domínio no Resend e publique no DNS os registros apresentados por ele.
Crie uma API key e configure `RESEND_API_KEY`, `EMAIL_FROM` e `EMAIL_REPLY_TO` no Railway.

## 3. Web no Cloudflare Pages

Crie um projeto Pages conectado ao repositório:

- Root directory: `externals/mobile`
- Build command: `npx expo export --platform web`
- Output directory: `dist`
- Variável: `EXPO_PUBLIC_API_URL=https://URL-DA-API`

O arquivo `public/_redirects` permite abrir diretamente links como
`/redefinir-senha?token=...`.

## 4. Verificação

1. Abra `/health` na URL da API.
2. Abra o site e faça login.
3. Solicite recuperação para um usuário com e-mail único e válido.
4. Use o link em até 30 minutos e confirme que sessões anteriores foram revogadas.
