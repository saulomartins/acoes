# Tutorial: configurar integração bancária (boleto e extrato) em produção

Público: admin geral / quem opera o sistema. Vale para qualquer banco cadastrado
em **Gestão de bancos**; hoje só o **Banco Inter** tem adaptador operacional
(`adapter_key = 'inter'`). Banco do Brasil e Bradesco aparecem no catálogo como
"Adaptador pendente": dá para cadastrar a configuração, mas o sistema ainda não
emite boleto nem lê extrato nesses bancos (exige desenvolvimento de código).

## Como o sistema enxerga uma integração

Três peças independentes. Erro em qualquer uma quebra a funcionalidade:

1. **Aplicação no banco** (painel do banco): gera Client ID, Client Secret e o
   par certificado/chave, e define os **escopos** permitidos.
2. **Configuração bancária** (app: Gestão de bancos → Nova configuração):
   guarda Client ID, Client Secret, caminho do certificado, caminho da chave,
   URL base, endpoint de token e escopos.
3. **Vínculo** (app: Vincular banco ao condomínio): liga uma configuração a um
   condomínio por **finalidade** — `boleto` (cobrança) e/ou `extrato`
   (prestação de contas: despesas, saldo, PDF do extrato).

Sem vínculo `extrato`, "Preencher dados do mês" não traz despesas/saldo e
"Baixar extrato em PDF" responde "Nenhuma integração bancária de extrato
configurada".

## De onde vem o valor de cada campo

| Campo | Onde conseguir | Banco Inter |
|---|---|---|
| Client ID | Gerado pelo banco ao criar a aplicação | Integrar → Nova Integração |
| Client Secret | Idem, exibido uma única vez. Perdeu: gere outro no painel do banco. Ao trocar, informe junto com o Client ID | idem |
| Caminho do certificado / chave | Arquivos baixados no painel do banco, copiados para o servidor (Passo 2); o campo guarda o caminho final | `/data/certs/NOME.crt` e `.key` |
| URL base da API | Documentação do desenvolvedor do banco | `https://cdpj.partners.bancointer.com.br` |
| Endpoint de autenticação | Documentação do banco (token OAuth) | `/oauth/v2/token` |
| Escopos da API | Permissões habilitadas na aplicação, separadas por espaço | `boleto-cobranca.write boleto-cobranca.read extrato.read` |

Outros bancos: os valores vêm do portal do desenvolvedor de cada banco.

## Passo 1 — Criar a aplicação no banco (Inter)

Internet Banking Empresas → Integrar → Portal do Desenvolvedor / Nova Integração.

- Marque **todos os escopos de uma vez**, na criação: cobrança
  (`boleto-cobranca.write`, `boleto-cobranca.read`) e extrato/saldo
  (`extrato.read`). O Inter geralmente não permite acrescentar escopo depois.
- Ao concluir, **copie na hora o Client ID e o Client Secret** e guarde num
  gerenciador de senhas. O Inter não mostra o secret de novo.
- Baixe o certificado (`.crt`) e a chave (`.key`) dessa aplicação.
- As integrações listadas no painel do Inter (ex.: "EXTRATO NOVO",
  "GERAR BOLETO") não exibem Client ID/Secret nem IP autorizado; não dá para
  conferir credenciais por lá.

## Passo 2 — Colocar certificado e chave no servidor

`externals/api/certs/` está no `.gitignore` de propósito: segredos nunca vão
para o Git nem para o deploy. Em produção (Railway, serviço `acoes`) os
arquivos ficam no **volume persistente `/data`**, em `/data/certs/`.

Pré-requisito: Railway CLI logado (`railway whoami`) e, na pasta
`externals/api`, `railway status` mostrando projeto `agile-amazement`,
ambiente `production`, serviço `acoes`.

PowerShell, a partir de `externals\api`:

```powershell
Get-Content certs\NOME.crt -Raw | railway ssh --service acoes --environment production -- "mkdir -p /data/certs && cat > /data/certs/NOME.crt"
Get-Content certs\NOME.key -Raw | railway ssh --service acoes --environment production -- "cat > /data/certs/NOME.key"
```

Confirme que chegaram (tamanho igual ao local):

```powershell
railway ssh --service acoes --environment production -- "ls -la /data/certs/"
```

Use nomes diferentes por aplicação (`inter-unificado.crt`, não sobrescreva
`inter.crt` se outro vínculo ainda o usa). O volume tem 500 MB; certificados
ocupam poucos KB.

## Passo 3 — Cadastrar a configuração no app

Gestão de bancos → Nova configuração bancária (ou Editar uma existente):

| Campo | Valor em produção |
|---|---|
| Banco cadastrado | Banco Inter |
| Nome | Descritivo e **único** (ex.: `Templum - Inter Unificado`) |
| Client ID | Do passo 1 |
| Client Secret | Do passo 1 (**ver alerta abaixo**) |
| Caminho do certificado | `/data/certs/NOME.crt` |
| Caminho da chave privada | `/data/certs/NOME.key` |
| URL base | `https://cdpj.partners.bancointer.com.br` |
| Endpoint de autenticação | `/oauth/v2/token` |
| Escopos | Exatamente os marcados no passo 1, separados por espaço. Ex.: `boleto-cobranca.write boleto-cobranca.read extrato.read` |
| Estado | Ativa |

Alertas:

- **Caminho sempre absoluto em `/data/certs/`.** `./certs/...` só existe no seu
  computador; em produção gera "Certificado do Banco Inter não encontrado".
- **Client Secret em branco = "manter o atual".** Se você trocar o Client ID
  de uma configuração existente e deixar o secret vazio, o sistema mantém o
  secret **antigo** com o Client ID **novo**. O par fica inválido e o Inter
  pode responder com erros enganosos (como "requested scope is not registered
  for this client"). Ao trocar Client ID, **sempre preencha também o secret**.
- Evite várias configurações com nomes parecidos (ex.: "...Inter",
  "...Inter (Extrato)", "...Inter (Unificado)"). Depois de validar a nova,
  desabilite ou apague as antigas.

## Passo 4 — Vincular ao condomínio

Vincular banco ao condomínio:

1. Marque as finalidades: **Cobrança (boletos)** e/ou **Extrato bancário**.
   Se uma única aplicação do banco tem os dois escopos, deixe as duas marcadas.
2. Escolha o condomínio.
3. Escolha a configuração e **confira o Client ID na descrição** antes de salvar.
4. Em boleto, defina o período de busca. Atenção: escolher "a partir de um
   período" **exclui permanentemente** boletos já importados com vencimento
   anterior ao mês inicial.
5. Salvar. A lista de condomínios passa a mostrar "Boleto: <config> · Extrato:
   <config>". "Extrato: nenhuma configuração" = falta o vínculo.

## Passo 5 — Validar

1. Gestão de bancos → "Testar conexão" na configuração (obtém token OAuth de
   verdade).
2. Prestação de contas → "Preencher dados do mês": devem vir despesas e saldo
   sem avisos.
3. "Baixar extrato em PDF" deve baixar o arquivo.

## Diagnóstico por mensagem de erro

| Mensagem | Causa provável | Ação |
|---|---|---|
| Nenhuma integração bancária de extrato configurada | Falta vínculo `extrato` | Passo 4, marcar "Extrato bancário" |
| Certificado/Chave do Banco Inter não encontrado em ... | Caminho errado ou arquivo fora do volume | Passos 2 e 3 (usar `/data/certs/...`) |
| requested scope is not registered for this client | (a) escopo não habilitado na aplicação do Inter; (b) escopo digitado diferente do habilitado; (c) Client ID trocado com Client Secret antigo | Conferir escopos no Passo 1; reinformar Client ID **e** Secret juntos |
| Integração Banco Inter desabilitada ou incompleta | Configuração inativa ou campo obrigatório vazio | Ativar e preencher todos os campos |
| Erros de TLS/permissão de acesso | Certificado e chave de aplicações diferentes | Usar o par correto da mesma aplicação |

Caso real (setembro/2026, condomínio Templum): o mesmo Client ID e certificado
funcionaram rodando localmente e falharam em produção com "requested scope is
not registered". A configuração em produção tinha caminhos e escopos corretos;
a hipótese principal é o Client Secret desalinhado do Client ID (ver alerta do
Passo 3). Se persistir com o secret correto, abrir chamado no suporte do Inter
informando o Client ID e o IP de saída do servidor (descubra com
`railway ssh --service acoes --environment production -- "node -e \"require('https').get('https://api.ipify.org',r=>r.pipe(process.stdout))\""`;
o IP pode mudar entre deploys).

## Comparar local x produção com segurança

- Localmente, a API e o app sobem com `npm run dev` (em `externals/api`) e
  `npm run web` (em `externals/mobile`). O banco local é diferente do de
  produção: IDs e configurações **não** são os mesmos.
- Leitura/escrita direta no banco de produção é ação sensível: faça você mesmo
  no seu terminal via `railway ssh` (o banco só é acessível de dentro do
  contêiner, `postgres.railway.internal`), prefira sempre a tela do app, e
  apague scripts temporários depois de usar.
- Nunca cole Client Secret, chave privada ou `.env` em chat, commit ou
  documento.

## Adicionar um banco novo (Banco do Brasil, Bradesco, outros)

1. Gestão de bancos → Bancos cadastrados: o catálogo já lista os três nomes; um
   banco fora da lista pode ser cadastrado (fica sem adaptador).
2. Cadastre a configuração (Passo 3) e o vínculo (Passo 4) normalmente.
3. Para o sistema **usar** esse banco (emitir boleto, ler extrato), é preciso
   implementar o adaptador no código da API (hoje só `interService.ts`) e
   marcar o banco como operacional. Sem isso, o cadastro é apenas informativo.
