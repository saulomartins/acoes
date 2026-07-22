# Condominio API

API Node.js + Express + TypeScript para o aplicativo de condominio.

## Instalacao

```bash
cd api
npm install
cp .env.example .env
# configurar DATABASE_URL e segredos JWT
npm run dev
```

Para o app web local, mantenha a API em modo de desenvolvimento:

```env
NODE_ENV=development
APP_WEB_URL=http://localhost:8081
CORS_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
```

Em producao, configure `NODE_ENV=production`, `APP_WEB_URL` e `CORS_ORIGINS`
com os dominios HTTPS reais no provedor de hospedagem.

## Banco de dados

O schema inicial esta em `src/db/schema.sql`.

```bash
npm run db:setup
```

Para desenvolvimento local com Docker, este projeto usa PostgreSQL na porta `5433`,
porque a `5432` pode estar ocupada por outro projeto:

```bash
docker run --name app-cond-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -p 5433:5432 -d postgres:15
npm run db:setup
```

## Recursos atuais

- Autenticacao com bcrypt, JWT de acesso e refresh token persistido com hash.
- Perfis: `sindico`, `subsindico`, `proprietario`, `inquilino`.
- CRUD inicial de condominios e usuarios.
- Lancamento de despesas.
- Geracao de boletos com ponto de integracao para Banco Inter.
- Registro de dispositivos e notificacoes com ponto de integracao para FCM.

## Banco Inter

A autenticacao OAuth do Inter usa `client_credentials` com certificado mTLS.
Em producao, a configuracao e por condominio, cadastrada pelo `admin_geral`
na tela de condominios. Cada condominio pode ter seu proprio `clientId`,
`clientSecret`, certificado, chave e escopos.

As variaveis abaixo continuam aceitas como fallback de desenvolvimento:

```bash
INTER_CLIENT_ID=
INTER_CLIENT_SECRET=
INTER_CERT_PATH=
INTER_KEY_PATH=
INTER_CERT_PASSPHRASE=
INTER_BASE_URL=https://cdpj.partners.bancointer.com.br
INTER_TOKEN_PATH=/oauth/v2/token
INTER_SCOPES=boleto-cobranca.write boleto-cobranca.read
```

Os certificados podem ficar em `certs/`, que esta no `.gitignore`.
Enquanto um condominio nao tiver integracao ativa cadastrada, os boletos
ficam com status `pending_provider`.

Com as credenciais configuradas por condominio, a API obtem e cacheia o token
do Inter para aquela integracao; o proximo passo e plugar o endpoint de emissao
da cobranca Bolepix com o payload oficial.
