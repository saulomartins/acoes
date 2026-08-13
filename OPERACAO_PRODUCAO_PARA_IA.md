# Runbook de produção para outra IA

Este documento descreve como uma IA deve validar e publicar o Lar em Dia sem
expor segredos nem sobrescrever alterações locais.

## Arquitetura e destinos oficiais

| Componente | Plataforma | Destino |
| --- | --- | --- |
| Web | Cloudflare Pages | `https://gestaolaremdia.com` |
| Projeto web | Cloudflare Pages | `lar-em-dia` |
| API | Railway | `https://acoes-production.up.railway.app` |
| Serviço da API | Railway | projeto `agile-amazement`, serviço `acoes`, ambiente `production` |
| Banco | Railway PostgreSQL | recurso `Postgres` do projeto `agile-amazement` |
| Android APK | Expo EAS | projeto `6c015dce-36b8-4c36-841b-23ea66a334ee` |

O repositório Git está nesta pasta. A API está em `api` e o aplicativo
Expo/React Native está em `mobile`.

## Regras para a IA operadora

1. Ler `git status --short` antes de tudo. Não descartar, resetar nem substituir
   mudanças locais; elas pertencem ao usuário.
2. Nunca imprimir, copiar para o documento ou versionar tokens, senhas,
   certificados, `.env` ou valores retornados por `railway variables`.
3. Pedir autorização explícita antes de enviar o código a um serviço externo.
   Login em navegador, deploy, migração e envio ao EAS são ações externas.
4. Fazer build local antes de cada deploy.
5. Usar o projeto Cloudflare `lar-em-dia`. O projeto antigo
   `condominio-app` não controla o domínio oficial.
6. O Railway tem como root directory `/externals/api`. Ao usar `railway up`,
   executar a partir da pasta que contém `api`, isto é, a raiz deste repositório.
7. Não executar `npm audit fix --force` durante um deploy. Isso pode introduzir
   mudanças incompatíveis e deve ser tratado em uma tarefa separada.

No Windows, se a política do PowerShell bloquear arquivos `.ps1`, chamar as
CLIs pelos executáveis `.cmd`, por exemplo:

```powershell
& "$env:APPDATA\npm\wrangler.cmd" whoami
& "$env:APPDATA\npm\railway.cmd" status
& "$env:APPDATA\npm\eas.cmd" whoami
```

## 1. Validação local

Na raiz do repositório:

```powershell
git status --short
git branch --show-current
git remote -v

Set-Location api
npm.cmd run build

Set-Location ..\mobile
$env:EXPO_PUBLIC_API_URL = 'https://acoes-production.up.railway.app'
npm.cmd run build:web
```

Interromper se algum build falhar. Corrigir e repetir antes de publicar.

## 2. Publicação da API no Railway

Confirmar que a CLI aponta para:

- projeto: `agile-amazement`
- ambiente: `production`
- serviço: `acoes`

```powershell
& "$env:APPDATA\npm\railway.cmd" login
& "$env:APPDATA\npm\railway.cmd" status
```

Executar o upload na raiz do repositório, a pasta que contém `api`:

```powershell
& "$env:APPDATA\npm\railway.cmd" up --service acoes --environment production
& "$env:APPDATA\npm\railway.cmd" deployment list --service acoes --environment production
```

Se o build falhar, obter o ID e consultar:

```powershell
& "$env:APPDATA\npm\railway.cmd" logs --build ID_DO_DEPLOY --lines 200
```

Só avançar quando o deploy novo aparecer como `SUCCESS`. Conferir a
inicialização:

```powershell
& "$env:APPDATA\npm\railway.cmd" logs --deployment ID_DO_DEPLOY --lines 100
```

## 3. Atualização do banco

`api/src/db/schema.sql` usa operações idempotentes como `create table if not
exists` e `alter table ... add column if not exists`. Ainda assim, revisar o
diff do schema antes de cada execução e procurar por `drop`, alterações de tipo
ou operações destrutivas.

O hostname `postgres.railway.internal` só resolve dentro do Railway. Portanto,
não usar `railway run` local para esta migração. Executar dentro do contêiner.

O caminho abaixo (`npm run db:setup`) **falha hoje** com
`FATAL ERROR: Reached heap limit Allocation failed` — o `ts-node` compila o
projeto inteiro em memória e estoura o limite do contêiner:

```powershell
# NÃO usar: estoura a memória do contêiner
& "$env:APPDATA\npm\railway.cmd" ssh --service acoes --environment production "npm run db:setup"
```

Use a versão já compilada pelo deploy. O `tsc` não copia o `.sql` para o
`dist`, então é preciso copiar o schema antes:

```powershell
& "$env:APPDATA\npm\railway.cmd" ssh --service acoes --environment production `
  "mkdir -p dist/db && cp src/db/schema.sql dist/db/schema.sql && node dist/scripts/setupDatabase.js"
```

O resultado esperado é:

```text
Database "railway" already exists.
Schema applied successfully.
```

Para migrações futuras, preferir arquivos versionados, idempotentes e com
rollback documentado. Fazer backup antes de qualquer migração destrutiva.

## 4. Publicação web no Cloudflare Pages

Gerar novamente o build com o endpoint oficial e publicar no projeto correto:

```powershell
Set-Location mobile
$env:EXPO_PUBLIC_API_URL = 'https://acoes-production.up.railway.app'
npm.cmd run build:web

& "$env:APPDATA\npm\wrangler.cmd" login
& "$env:APPDATA\npm\wrangler.cmd" pages project list
& "$env:APPDATA\npm\wrangler.cmd" pages deploy dist --project-name lar-em-dia --branch master
```

Guardar a URL imutável retornada pelo deploy. O domínio
`https://gestaolaremdia.com` deve apontar para a nova produção.

## 5. APK Android pelo Expo EAS

O perfil `production-apk` em `mobile/eas.json` gera um APK de distribuição
interna e injeta a URL oficial da API.

Depois de obter autorização explícita do usuário para enviar o código ao Expo:

```powershell
Set-Location mobile
& "$env:APPDATA\npm\eas.cmd" login --browser
& "$env:APPDATA\npm\eas.cmd" whoami
& "$env:APPDATA\npm\eas.cmd" build --platform android --profile production-apk --non-interactive
```

Ao terminar, registrar a URL do artefato e baixá-lo para uma pasta de release
do workspace, sem versionar o APK. Validar ao menos:

- instalação em aparelho ou emulador;
- abertura sem crash;
- login e uma chamada autenticada;
- endpoint compilado igual a `https://acoes-production.up.railway.app`;
- versão e ícone corretos.

Para a Google Play, o artefato adequado é AAB, não APK:

```powershell
& "$env:APPDATA\npm\eas.cmd" build --platform android --profile production --non-interactive
```

Não enviar à Play Store automaticamente sem autorização específica.

## 6. Smoke tests pós-publicação

```powershell
$targets = @(
  'https://acoes-production.up.railway.app/health',
  'https://gestaolaremdia.com'
)

foreach ($target in $targets) {
  $response = Invoke-WebRequest -Uri $target -UseBasicParsing -TimeoutSec 30
  "$target => $($response.StatusCode)"
}
```

Resultado esperado: HTTP `200` nos dois endereços. Depois, testar manualmente:

1. carregar o site em janela anônima;
2. fazer login;
3. abrir uma tela que consulta a API;
4. verificar o console do navegador e os logs Railway;
5. confirmar que não há erros CORS ou respostas 5xx.

## 7. Rollback

- Railway: localizar o último deploy `SUCCESS` anterior no painel ou na lista
  de deployments e fazer redeploy/rollback para ele.
- Cloudflare Pages: no painel do projeto `lar-em-dia`, promover novamente o
  deployment anterior.
- Banco: não tentar rollback improvisado. Usar o backup e o script de rollback
  preparados para a migração específica.
- APK: manter o link/build anterior disponível até concluir os testes da nova
  versão.

Após rollback, repetir os smoke tests e registrar qual versão voltou a operar.

## 8. Central de instaladores Android e iOS

A rota autenticada `Instalar aplicativo` exibe sempre o registro ativo mais
recente de cada plataforma. Usuários comuns podem baixar/abrir a instalação; o
perfil `admin_geral` também pode publicar, reativar e remover versões.

- Android: o administrador pode enviar um APK de até 150 MB. O arquivo fica no
  volume persistente em `/data/mobile-releases`, fora da imagem do deploy.
- iOS: cadastrar uma versão e o link HTTPS oficial da App Store ou TestFlight.
  Não armazenar nem oferecer IPA genérico, pois a instalação depende da
  assinatura e distribuição Apple.
- Metadados e histórico ficam na tabela `mobile_releases`.
- API: `/mobile-releases`.
- Tela: `mobile/src/screens/MobileReleases.tsx`.

Para cadastrar uma versão pela interface:

1. Entrar como `admin_geral`.
2. Abrir `Instalar aplicativo`.
3. Escolher Android ou iOS.
4. Informar versão, build e notas.
5. Para Android, selecionar o APK; para iOS, informar App Store/TestFlight.
6. Publicar e confirmar que o cartão superior mostra a nova versão.

Para inicialização auditável de um APK já produzido, há um comando interno que
baixa o artefato, valida SHA-256, grava no volume e cria o registro:

```powershell
& "$env:APPDATA\npm\railway.cmd" ssh --service acoes --environment production `
  npm run releases:seed-android -- URL VERSION BUILD SHA256
```

Nunca executar o seed sem checksum obtido previamente do artefato assinado.

### Fluxo obrigatório automatizado para todo APK

Toda nova versão Android deve usar o pipeline abaixo. Ele:

1. envia o build `production-apk` ao EAS;
2. aguarda a assinatura com a keystore oficial;
3. baixa o arquivo para `externals/releases`;
4. nomeia como `lar-em-dia-VERSAO-build-NUMERO-production.apk`;
5. calcula o SHA-256;
6. valida a assinatura com `apksigner`;
7. copia o mesmo artefato, conferido pelo hash, para o volume Railway;
8. cadastra/promove a versão no módulo `Instalar aplicativo`;
9. grava `releases/latest-android-release.json` como comprovante.

Comando completo:

```powershell
Set-Location mobile
npm.cmd run release:apk
```

Como a fila EAS pode levar horas, é permitido iniciar e retomar:

```powershell
# Envia e retorna o buildId sem ficar bloqueado
npm.cmd run release:apk:start

# Consulta sem baixar/publicar
npm.cmd run release:apk:check -- --build-id BUILD_ID

# Quando concluído, baixa, valida e publica automaticamente
npm.cmd run release:apk:resume -- --build-id BUILD_ID
```

Para testar download e assinatura sem publicar na central:

```powershell
node scripts/publish-apk.js --build-id BUILD_CONCLUIDO --no-publish
```

Nesse modo, o comprovante é `releases/last-validated-apk.json`. APKs e arquivos
de estado em `releases` são ignorados pelo Git; nunca versionar binários.

## Registro da publicação de 28/07/2026

- Web: deployment corrigido `05d53cf7.lar-em-dia.pages.dev`, HTTP 200.
- Domínio oficial: `gestaolaremdia.com`, HTTP 200.
- Correção web: o arquivo `.env` local embutia `http://localhost:3000` no
  bundle. `mobile/src/api/client.ts` agora recusa endpoints loopback em builds
  de produção e usa a API Railway. O bundle publicado contém
  `https://acoes-production.up.railway.app`; o POST de smoke test chegou ao
  endpoint `/auth/login` e recebeu CORS para o domínio oficial.
- API: deployment Railway `d8d2cdc9-c6ba-44df-bc61-5dd986c7f175`,
  substituído pelo deployment `b1eef112-6fd1-4fbb-887d-c068dae6fde8`,
  status `SUCCESS`.
- Health da API: HTTP 200.
- Banco: schema aplicado com sucesso no PostgreSQL de produção.
- Histórico de acordos: corrigido erro 500 causado pela ausência da coluna
  `debt_agreements.canceled_all_boletos_at` na tabela existente. O schema agora
  possui `alter table ... add column if not exists` para todas as colunas de
  cancelamento de acordos e parcelas; `npm run db:setup` foi executado dentro
  do contêiner após o deploy. Nenhum novo erro foi registrado nos logs
  posteriores à migração.
- APK: autorizado e enviado ao EAS. Build
  `95799164-75bf-455b-881b-7d63b23bc4d2`, Android `1.0.0`, versionCode `3`,
  perfil `production-apk`; aguardando executor na fila normal no momento deste
  registro. Página do build:
  `https://expo.dev/accounts/saulomartins/projects/lar-em-dia/builds/95799164-75bf-455b-881b-7d63b23bc4d2`.
- APK de produção disponível imediatamente: build EAS concluído
  `aeee9c3c-4082-4d1f-9ec6-d7690ff07d60`, pacote
  `com.appcond.condominio`, versão `1.0.0`, versionCode `3`, minSdk `24` e
  targetSdk `36`. Arquivo local:
  `releases/lar-em-dia-1.0.0-build-3-production.apk` (67.895.000 bytes).
  SHA-256:
  `70288854ABA1EEC4491683CCD8BBA49F0A9419567C8E04BC99F4109DBE81C7D5`.
  A assinatura APK Scheme v2 foi validada com `apksigner`; há um signer RSA de
  2048 bits.
- Central de instaladores: API Railway deployment
  `7acae8e2-e8cc-4b30-b89d-5e01c190d56e`, web Cloudflare deployment
  `b829fc5b.lar-em-dia.pages.dev`. Android `1.0.0` build `3` foi copiado para o
  volume persistente e cadastrado como versão atual após validação do SHA-256.
  O iOS está pronto para receber o link da App Store/TestFlight quando
  disponível.

## Publicação 1.1.0 de 28/07/2026

- Web: deployment Cloudflare `a979b114.lar-em-dia.pages.dev`; domínio
  `gestaolaremdia.com` validado com HTTP 200 e bundle
  `AppEntry-16c9c2600ea9f4819e99e24f4bbc9b16.js`.
- API: deployment Railway `8648a646-d7a2-40e5-ad1e-d81c2fe65788`,
  status `SUCCESS`; health HTTP 200.
- Banco: `npm run db:setup` executado dentro do contêiner; schema aplicado com
  sucesso.
- Android: versão `1.1.0`, versionCode `4`, perfil `production-apk`, keystore
  remota de produção. Build EAS
  `818f5c2d-9b9d-4935-b00a-57dd9bf9aaa3`. Enquanto estiver `IN_QUEUE`, manter
  Android `1.0.0` build `3` como versão atual na central. Quando terminar,
  baixar, validar assinatura/SHA-256 e publicar o APK `1.1.0` pela própria
  central ou pelo comando `releases:seed-android`.
- O build `1.1.0`/`4` foi cadastrado antecipadamente na central com o link da
  página oficial do EAS e a indicação de processamento. A web possui um banner
  persistente “NOVA VERSÃO” que abre `Instalar aplicativo`; no app nativo o
  mesmo banner só aparece quando a versão publicada é superior à instalada.
  Web deployment `26001e34.lar-em-dia.pages.dev`, bundle
  `AppEntry-2c4fb1190aac7e3bb031d84f35f6f117.js`; API deployment
  `9fb7b881-9a9f-4cc7-afef-cff18e1ccd57`.
- Pipeline obrigatório publicado e testado em Windows. O teste completo baixou
  um APK EAS concluído para `externals/releases`, calculou SHA-256 e confirmou
  assinatura APK Scheme v2, sem alterar a central (`--no-publish`).
- A versão mobile atual foi elevada para `1.2.0`, versionCode `5`, build EAS
  `a90368fc-86c1-40bf-8682-f23d948d2647`. O build `1.1.0/4` obsoleto foi
  cancelado. O `1.2.0/5` aparece na central como “em processamento”; quando o
  EAS concluir, executar `npm.cmd run release:apk:resume -- --build-id
  a90368fc-86c1-40bf-8682-f23d948d2647`.
- Deploys desta revisão: web `2d357b54.lar-em-dia.pages.dev`; API Railway
  `274fb9c4-ea19-4414-8651-0c373cd7ba71`.
- Um monitor local foi iniciado em segundo plano para concluir automaticamente
  o build `1.2.0/5`. Logs:
  `releases/apk-1.2.0-pipeline.log` e
  `releases/apk-1.2.0-pipeline-error.log`. Ao finalizar, o arquivo deve existir
  como `releases/lar-em-dia-1.2.0-build-5-production.apk` e o comprovante como
  `releases/latest-android-release.json`; a central web será promovida pelo
  próprio pipeline.

## Publicação 1.2.4 de 10/08/2026

Publicada a partir da working tree do `master` (68 arquivos ainda não
commitados no momento do deploy; commitados logo em seguida). Além dos
ajustes desta revisão, subiram features que ainda não tinham ido a
produção: certidão negativa (`clearanceService`/`Clearances`/
`ClearanceVerify`), indicadores de boletos (`BillingAnalytics`), tour de
telas (`FeatureTour`/`useSectionTour`) e o novo ícone do app.

- API: deployment Railway `bcaa769e-a7de-41c3-99ff-aefad9e8d0db`,
  status `SUCCESS`; health HTTP 200.
- Banco: `dist/scripts/setupDatabase.js` executado dentro do contêiner
  (schema.sql copiado para `dist/db` antes, como manda a seção 3).
  Resultado `Schema applied successfully`. O diff do schema tinha +51
  linhas e nenhuma operação destrutiva.
- Web: deployment Cloudflare `043abf53.lar-em-dia.pages.dev`; domínio
  `gestaolaremdia.com` HTTP 200 servindo o bundle
  `AppEntry-1fc7bb2606d9cd7edb28d70482ae40b8.js`, o mesmo gerado no build
  local. Conferido antes de publicar que o bundle contém
  `acoes-production.up.railway.app` e nenhuma ocorrência de
  `localhost:3000`.
- Smoke test: `POST /auth/login` em produção com credencial inexistente
  devolveu HTTP 401 (não 500) e `access-control-allow-origin:
  https://gestaolaremdia.com`, confirmando o caminho API→banco após a
  migração.
- Android: versão `1.2.4`, versionCode `15` (auto-incrementado pelo EAS,
  `appVersionSource: remote` — o `versionCode` do `app.json` é ignorado).
  Build EAS `112e45cf-6de3-4869-87e6-cbc3bec20f0f`, perfil
  `production-apk`, concluído. Arquivo
  `releases/lar-em-dia-1.2.4-build-15-production.apk` (69.449.580 bytes).
  SHA-256:
  `140F9AC037303A531EBCC41BD26FC2392F130751B6C99104FC21009EBD1243FB`.
  Assinatura APK Scheme v2 validada com `apksigner`; um signer RSA de
  2048 bits. O mesmo hash foi conferido em três pontos: artefato do EAS,
  arquivo local e `/data/mobile-releases` no volume do Railway. Central
  com `android 1.2.4 build 15 active=true` como único registro ativo.

  O `versionCode` do `app.json` estava em `1` (menor que o `14` já
  publicado). Isso **não** é problema porque `eas.json` usa
  `appVersionSource: remote` com `autoIncrement`, então o EAS ignora o
  valor local. Não "corrigir" esse número achando que é um bug.

### `releases:seed-android` estoura a memória do contêiner

O pipeline `release:apk:resume` falhou no último passo com
`FATAL ERROR: Reached heap limit Allocation failed`. É o **mesmo**
problema já documentado na seção 3 para `npm run db:setup`: o script
roda via `ts-node`, que compila o projeto inteiro em memória e estoura o
limite do contêiner.

`mobile/scripts/publish-apk.js` chama:

```text
railway ssh ... npm run releases:seed-android -- URL VERSION BUILD SHA256
```

e `releases:seed-android` é `ts-node --files src/scripts/seedAndroidRelease.ts`.

Enquanto o pipeline não for corrigido, todo release Android vai falhar
nesse ponto. O APK, o SHA-256 e a validação de assinatura já terão sido
feitos — só a publicação na central fica pendente. Concluir à mão com a
versão compilada, pegando a URL do artefato e o SHA-256 do log do
pipeline:

```powershell
& "$env:APPDATA\npm\railway.cmd" ssh --service acoes --environment production `
  "node dist/scripts/seedAndroidRelease.js URL_DO_ARTEFATO VERSAO BUILD SHA256"
```

A saída esperada é `Android X.Y.Z build N already exists and was promoted.`
ou a criação do registro. Depois confirmar o SHA-256 do arquivo em
`/data/mobile-releases` e o `active=true` em `mobile_releases`.

A correção definitiva é trocar a chamada em `publish-apk.js` para o
script compilado, do mesmo jeito que a seção 3 já faz com
`setupDatabase.js`.

### Ajustes de código desta revisão

- Comunicados: síndico/subsíndico que também é morador passa a receber os
  próprios avisos gerais e pode se selecionar no envio pessoal. O par
  síndico+morador pode estar em qualquer ordem (um lado em `users.role`,
  o outro em `user_profiles`), por isso as duas origens são consultadas.
- Gestão de débitos: boletos `pending_provider` ("Aguardando Inter")
  deixaram de contar como débito — não há o que o morador pague enquanto
  o banco não confirma o registro. Também saíram do total "Em aberto" do
  painel, onde eram contados duas vezes (já existia o card "Aguardando o
  banco" com os mesmos boletos).

## Publicação 1.2.5 de 10/08/2026

Sem migração de banco: `schema.sql` não mudou desde a 1.2.4, então o passo 3
foi deliberadamente pulado. Rodar `setupDatabase` sem diff de schema é
operação desnecessária em produção.

- Commits publicados: `46c5f4b` (login por usuário/CPF/e-mail, ComboBox de
  unidade, PDF só após registro no banco) e `c4112ab` (regimento restrito ao
  condomínio, rótulos e comboboxes nas telas do admin).
- API: deployment Railway `d7bf5c02-c840-4d96-a448-428d1c644667`,
  status `SUCCESS`; health HTTP 200.
- Web: deployment Cloudflare `9d8f39e4.lar-em-dia.pages.dev`; domínio
  `gestaolaremdia.com` HTTP 200 servindo o bundle
  `AppEntry-d8050149579af746c5f08a829f3de1e7.js`, idêntico ao gerado no build
  local.
- Conferido no bundle antes de publicar: contém
  `acoes-production.up.railway.app`, nenhuma ocorrência de `localhost:3000`,
  e os textos novos das três frentes (login por CPF/e-mail, ComboBox de
  unidade, aviso de boleto aguardando o banco).
- Smoke test: `POST /auth/login` em produção com um CPF inexistente devolveu
  HTTP 401 (não 500) e `access-control-allow-origin: https://gestaolaremdia.com`,
  confirmando que o novo caminho de múltiplos identificadores roda sem erro.
- Android: versão `1.2.5`, versionCode `16`, build EAS
  `433f3c68-5d59-4a31-9c91-4dcc6759b9b8`, perfil `production-apk`, concluído.
  Arquivo `releases/lar-em-dia-1.2.5-build-16-production.apk`
  (69.452.340 bytes). SHA-256:
  `41FBCD2CE694542EEA658A9A685A3CDFCCDEC4FB4FC6EF41AB5AA2BDE5CB905E`,
  conferido em três pontos: artefato do EAS, arquivo local e
  `/data/mobile-releases/d92c94f1-0a66-42b4-b1f0-91cbe5095e57.apk` no volume.
  Assinatura APK Scheme v2 validada, mesmo signer RSA 2048 das versões
  anteriores (chave pública SHA-256 `2dd2dd1a3b0b3024...`).
  O `releases:seed-android` estourou a memória de novo, como previsto na
  seção anterior; concluído com `node dist/scripts/seedAndroidRelease.js`.
- Central: `mobile_releases` tem 1.2.5/16 e 1.2.4/15 ambos com `active=true`.
  Isso é esperado: `GET /mobile-releases/latest` filtra por `active=true` e
  ordena por `published_at desc`, pegando o primeiro de cada plataforma —
  então 1.2.5 é a versão atual e a 1.2.4 fica no histórico, disponível para
  reativação pela própria central. Não é preciso desativar a anterior.

### Cuidado ao conferir strings acentuadas no bundle

Duas vezes um `grep` com `.` no lugar do acento deu falso negativo e passou a
impressão de que a mudança não tinha entrado no bundle. Em UTF-8 um caractere
acentuado ocupa 2 bytes e `.` casa 1 byte só. Ao validar um bundle, procurar
por um trecho **sem acento** da frase, por exemplo
`grep -c 'confirmou o registro deste boleto'` em vez de
`grep -c 'ainda n.o confirmou'`.

## Publicação 1.2.9 de 13/08/2026

Origem: conciliação dos boletos do condomínio Templum contra o relatório do
Banco Inter do período 01/01/2026 a 13/08/2026. Dos 268 boletos do relatório,
259 casaram com a base; as divergências viraram as correções desta versão.

- API: deployment Railway `c5fa59e1-474e-4e81-a947-c6ba702b0795`, status
  `SUCCESS`; health HTTP 200.
- Banco: `dist/scripts/setupDatabase.js` executado dentro do contêiner
  (`schema.sql` copiado para `dist/db` antes, como manda a seção 3).
  Resultado `Schema applied successfully`. Diff de +69 linhas; o único `drop`
  era da constraint `invoice_adjustments_type_check`, recriada na linha
  seguinte com dois valores a mais. Nada destrutivo.
- Web: deployment Cloudflare `e5047592.lar-em-dia.pages.dev`; domínio
  `gestaolaremdia.com` HTTP 200 servindo o bundle
  `AppEntry-2be84c391a9eda3e86cb7ea5a55d2048.js`, idêntico ao gerado no build
  local. Conferido antes de publicar: contém
  `acoes-production.up.railway.app`, nenhuma ocorrência de `localhost:3000`,
  e os textos novos das quatro frentes.
- Smoke test: `POST /auth/login` em produção com usuário inexistente devolveu
  HTTP 401 (não 500) e `access-control-allow-origin: https://gestaolaremdia.com`.
- Android: versão `1.2.9`, versionCode `21`, build EAS
  `a85d1f43-fe81-40e0-9fd0-0e41923f2511`, perfil `production-apk`.

### O que mudou

- **Boleto EXPIRADO deixou de ser exibido como "Vencido".** `INTER_STATUS_MAP`
  mapeia `EXPIRADO` para `overdue`, e o morador via "pague este boleto" num
  boleto que o Inter não aceita mais receber. A nova coluna
  `invoices.provider_situation` guarda a situação crua do banco e a tela passa
  a rotular por ela. O backfill promoveu a situação que já estava em
  `invoice_events`: em produção, 19 boletos `EXPIRADO`, 22 `RECEBIDO`,
  13 `A_RECEBER`, 8 `CANCELADO`, 3 `ATRASADO`, 1 `EM_PROCESSAMENTO` e
  1 `FALHA_EMISSAO`.
- **Retirar boleto da dívida, com justificativa obrigatória.**
  `PATCH /invoices/:id/debt-exclusion` (síndico/subsíndico). Um boleto
  expirado pode ter a dívida já quitada por um boleto posterior que
  consolidou o débito — caso real observado: um morador com quatro boletos
  expirados consolidados num quinto de R$ 1.055,52, pago via Pix, continuava
  aparecendo com R$ 1.537,14 em atraso. A retirada sai de Gestão de débitos,
  do painel e dos indicadores, é reversível e grava em `invoice_adjustments`.
- **Boletos do banco sem morador vinculado viraram pendência fixa.** A lista
  já era detectada em `importCharges`, mas só aparecia numa mensagem
  passageira do sync-all — na prática ninguém via. Agora persiste em
  `bank_unmatched_charges` e aparece em Gestão de cobranças. Em Templum eram
  8 boletos (R$ 2.182,40) de três pessoas sem cadastro no condomínio.
- **`pending_provider` não vira mais `overdue`.** `transitionOverdueInvoices`
  marcava como vencido um boleto que o banco ainda não confirmou — sem linha
  digitável nem Pix, o morador não teria como pagar, e ainda recebia push de
  cobrança. Agora só `issued` transiciona.
- **`importCharges` grava `invoice_events`.** Havia 214 boletos pagos sem
  nenhum evento, o que destruía a trilha de conciliação contra o extrato.
- **Gestão de débitos:** filtro por apartamento ou morador (ignora acento),
  chip "somente com débito em aberto", e separação visual entre os cards, que
  antes ficavam colados por falta de `gap` no container.
- **Tour guiado:** deixou de abrir por cima da tela "Entrar como". O efeito de
  autostart não checava `needsProfileSelection`, e como o Stack só monta
  aquela tela, cada passo navegava para uma rota inexistente.

### Guia de expansão bancária atualizado

O que foi construído aqui é **parcialmente** agnóstico a banco, e isso está
registrado na tela do admin geral:

- Agnóstico e reaproveitável: a retirada da dívida (vive em colunas da
  fatura, não consulta provedor), a garantia de que nenhuma rotina que fala
  com o banco escreve nessas colunas, e `bank_unmatched_charges`.
- Preso ao Inter: a detecção de "expirado" compara `provider_situation` com a
  palavra `EXPIRADO`, que é vocabulário do Inter. Em outro banco a mesma
  condição tem outro nome e o boleto impagável voltaria a aparecer como
  "Vencido", inclusive oferecendo pagar via Pix. Precisa virar um mapa por
  provedor antes do segundo banco entrar.

### Limitação conhecida desta revisão

`GET /invoices` re-sincroniza com o Inter todo boleto em aberto a cada
carregamento da tela. Alguns boletos já acumulavam mais de 120 eventos de
sync. É uma chamada à API do banco por boleto por abertura de tela; não foi
tratado aqui e merece tarefa própria.
