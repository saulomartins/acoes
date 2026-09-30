const { withGradleProperties } = require('expo/config-plugins');

// APK de distribuição direta (central "Instalar aplicativo") só com as
// arquiteturas de celular de verdade. O padrão do React Native compila também
// x86/x86_64, que só existem em emulador e deixavam cada APK com ~70 MB — e
// cada APK ocupa o volume do Railway (ver api/src/services/mobileReleaseStorage.ts).
//
// Só age quando ANDROID_ABIS está definido (perfis de APK em eas.json). O AAB
// da Play Store fica com todas: a loja já entrega a cada aparelho só a parte
// dele, e manter x86 não custa nada ao morador lá.
module.exports = function withAndroidAbis(config) {
  const abis = process.env.ANDROID_ABIS;
  if (!abis) return config;
  return withGradleProperties(config, (gradleConfig) => {
    const properties = gradleConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures'),
    );
    properties.push({ type: 'property', key: 'reactNativeArchitectures', value: abis });
    gradleConfig.modResults = properties;
    return gradleConfig;
  });
};
