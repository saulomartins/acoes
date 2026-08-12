import React from 'react';
import { Text as RNText, TextInput as RNTextInput, type TextInputProps, type TextProps } from 'react-native';
import { MAX_FONT_SCALE } from './theme';

// Text e TextInput do app inteiro passam por aqui em vez de virem direto do
// react-native. O motivo é o "tamanho da fonte" do sistema: o Android deixa o
// usuário escalar o texto até 2x, e o React Native aplica esse fator sem teto —
// blocos densos (cartões de indicadores, etiquetas, tabelas) quebravam palavra
// no meio ou estouravam a linha.
//
// Não dá para resolver com Text.defaultProps: o React 19 removeu defaultProps
// de componentes de função, e o Text do RN 0.81 é exatamente isso. Por isso o
// wrapper explícito.
//
// maxFontSizeMultiplier continua sobrescritível caso a chamada precise de outro
// teto, e o texto continua escalando até MAX_FONT_SCALE — a acessibilidade é
// preservada, só o extremo que destruía o layout é que fica de fora.
export const Text = ({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: TextProps) => (
  <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
);

export const TextInput = ({ maxFontSizeMultiplier = MAX_FONT_SCALE, ...props }: TextInputProps) => (
  <RNTextInput maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />
);
