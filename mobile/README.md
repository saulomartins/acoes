# Condomínio Mobile

Scaffold inicial para o app mobile (Expo + React Native + TypeScript).

Instruções rápidas para rodar o app Expo localmente.

Pré-requisitos
- Node.js (>=16)
- npm ou yarn
- Rede ativa para instalar dependências

Instalação
```bash
cd externals/mobile
npm install
```

Executar
```bash
# iniciar o Metro / Expo
npm run start
# para abrir em Android (se conectado/emulador)
npm run android
# para iOS (macOS)
npm run ios
```

Observações
- Se preferir `yarn`, substitua `npm install` por `yarn`.
- Caso tenha problemas de cache: `npx expo start -c`.

Recomenda-se usar `expo-secure-store` para guardar tokens de forma segura no dispositivo.
