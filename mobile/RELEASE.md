# Política de release do app

O app usa **EAS Update (OTA)** para publicar mudanças sem passar por review de loja, e **EAS Build** quando a mudança exige um binário novo.

## Quando usar `npm run update:production` (OTA, sem review)

Mudanças **puramente JavaScript**, sem tocar em nada nativo:
- Tela nova, ajuste de layout/estilo, texto, validação, lógica de negócio no cliente
- Chamadas novas para endpoints já existentes na API
- Correção de bug em código JS/TS

```
npm run update:production -- "descrição curta da mudança"
```

Use `npm run update:preview -- "..."` primeiro para validar no canal de testes antes de promover para produção.

**Importante:** o app instalado só recebe updates OTA se já tiver o runtime `expo-updates` embutido — ou seja, é preciso ter feito pelo menos um `build:apk`/`build:aab` **depois** desta configuração (ver `app.json`: `plugins`, `runtimeVersion`, `updates`) antes de depender de OTA em produção.

## Quando ainda precisa de `build:apk` / `build:aab` + submissão de loja

Qualquer mudança que altere o **binário nativo**:
- Novo módulo nativo ou dependência com código nativo (algo que peça `expo install` de um pacote com plugin de config)
- Nova permissão (câmera, localização, notificações, etc.)
- Mudança de ícone, splash screen, nome do pacote, `versionCode`/`bundleIdentifier`
- Upgrade de SDK do Expo/React Native
- Qualquer mudança em `app.json` fora de `extra`/`updates` (plugins, permissões, ios/android config)

Nesses casos, gerar o build normalmente (`npm run build:apk` ou `npm run build:aab`) e submeter à loja como hoje.

## Canais

- `preview` — usado pelo profile `preview` do EAS Build (`eas.json`)
- `production` — usado pelos profiles `production` e `production-apk`

Um update publicado em um canal só chega aos apps instalados a partir de um build feito com aquele canal já configurado.
