export const colors = {
  background: '#f5f7fb',
  surface: '#ffffff',
  ink: '#172033',
  navy: '#101a2e',
  muted: '#667085',
  border: '#e2e7f0',
  primary: '#2563c5',
  primaryDark: '#194d9d',
  green: '#0f927f',
  amber: '#d89a2b',
  red: '#d65454',
  teal: '#159b8b',
  lilac: '#7c3aed',
  sky: '#0ea5e9',
  placeholder: '#98a2b3',
  softBlue: '#eef4ff',
  softGreen: '#eaf8f3',
};

export const shadow = {
  shadowColor: '#14243a',
  shadowOffset: { width: 0, height: 5 },
  shadowOpacity: 0.08,
  shadowRadius: 16,
  elevation: 3,
};

export const layout = {
  sidebarWidth: 286,
  contentMaxWidth: 1440,
  radius: 14,
  controlRadius: 12,
};

// Teto para o "tamanho da fonte" do sistema (Android/iOS). Sem ele o usuário que
// configura fonte grande no aparelho recebe texto até 2x maior, e blocos densos
// (cartões de indicadores, etiquetas de situação) quebram palavras no meio.
// 1.3 preserva a acessibilidade sem destruir o layout.
export const MAX_FONT_SCALE = 1.3;
