import { Platform } from 'react-native';

// Bloqueia "cliques fantasmas" na web.
//
// No react-native-web, o onPress de Pressable/AppButton dispara com QUALQUER
// evento `click` do navegador — não exige que o toque tenha começado no botão
// (ver PressResponder.js: "it's possible for onPress to be called without
// onPress{Start,End}"). No celular, o navegador às vezes entrega um click num
// elemento onde o dedo nunca encostou: o teclado fecha ou um menu some, a
// tela se desloca, e o click sintetizado cai no botão que ficou embaixo. Foi
// a causa provável de um pedido de nada consta e de uma ocorrência que o
// próprio morador não enviou (out/2026).
//
// Regra: um click de ponteiro (detail > 0, isTrusted) só passa se o
// pointerdown mais recente aconteceu DENTRO do elemento clicado — num click
// legítimo o alvo é o ancestral comum entre onde o dedo desceu e subiu, então
// sempre contém o alvo do pointerdown. Clicks de teclado (Enter/Espaço) e
// programáticos (anchor.click() dos downloads) têm detail 0 e passam sempre.
const MAX_PRESS_MS = 10_000;

let installed = false;

export const installGhostClickGuard = () => {
  if (installed || Platform.OS !== 'web' || typeof window === 'undefined') return;
  installed = true;

  let lastDown: { target: Node; at: number } | null = null;

  window.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node) lastDown = { target: event.target, at: Date.now() };
  }, { capture: true, passive: true });

  window.addEventListener('click', (event) => {
    if (!event.isTrusted || event.detail === 0) return;
    const target = event.target instanceof Node ? event.target : null;
    // Campos nativos (input de arquivo, checkbox do Switch, select) e cliques
    // vindos de <label> ficam de fora: o click de um label cai no input, que
    // não contém o ponto do toque — e o risco aqui é só nos botões.
    const element = target instanceof Element ? target : target?.parentElement;
    if (element?.closest('input, select, textarea, option, label')) return;
    const down = lastDown;
    // Se o elemento tocado saiu do DOM antes do click (ex.: a lista de
    // sugestões que fechou), o click caiu em outra coisa: também é fantasma.
    // Nenhum botão do app troca de elemento no meio do toque (não há
    // onPressIn), então isso não bloqueia toque legítimo.
    const legit = !!down && !!target && down.target.isConnected && Date.now() - down.at <= MAX_PRESS_MS && target.contains(down.target);
    if (legit) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    console.warn('Clique ignorado: não começou neste elemento (toque fantasma).');
  }, { capture: true });
};
