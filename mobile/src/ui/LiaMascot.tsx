import React from 'react';

// Mascote da Lia, a atendente virtual do site: uma casinha (o símbolo do Lar
// em Dia) com rosto, cujo sorriso é o check verde do logo ("em dia"), e um
// balão de conversa com reticências no telhado. Desenhada em SVG e servida
// como data URI: não precisa de biblioteca nova e as animações (piscar e
// reticências) são SMIL, que o navegador roda dentro de <img>. É um <img> do
// DOM, e não o <Image> do React Native: com o <Image> do react-native-web o
// fundo da imagem nunca era aplicado e o avatar ficava em branco. A Lia só
// existe no build web, então não há caso nativo para tratar aqui.
const MASCOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5B54F0"/>
      <stop offset="1" stop-color="#8B3FF0"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.22" r="0.6">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="house" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#EEF0FE"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="32" fill="url(#bg)"/>
  <circle cx="32" cy="32" r="32" fill="url(#shine)"/>
  <ellipse cx="32" cy="56.5" rx="17" ry="2.6" fill="#2E1A87" opacity="0.28"/>
  <g transform="translate(32 34) scale(1.14) translate(-32 -34)">
    <path d="M32 13.5 L50.5 29.5 Q52 31 50.2 31 L47 31 L47 46 Q47 51.5 41.5 51.5 L22.5 51.5 Q17 51.5 17 46 L17 31 L13.8 31 Q12 31 13.5 29.5 Z" fill="url(#house)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
    <g fill="#1E1B4B">
      <ellipse cx="26.5" cy="37" rx="2.3" ry="2.9">
        <animate attributeName="ry" values="2.9;2.9;0.35;2.9;2.9" keyTimes="0;0.9;0.94;0.98;1" dur="4.5s" repeatCount="indefinite"/>
      </ellipse>
      <ellipse cx="37.5" cy="37" rx="2.3" ry="2.9">
        <animate attributeName="ry" values="2.9;2.9;0.35;2.9;2.9" keyTimes="0;0.9;0.94;0.98;1" dur="4.5s" repeatCount="indefinite"/>
      </ellipse>
    </g>
    <circle cx="27.3" cy="35.9" r="0.8" fill="#ffffff"/>
    <circle cx="38.3" cy="35.9" r="0.8" fill="#ffffff"/>
    <ellipse cx="22.3" cy="42" rx="2.6" ry="1.5" fill="#F472B6" opacity="0.55"/>
    <ellipse cx="41.7" cy="42" rx="2.6" ry="1.5" fill="#F472B6" opacity="0.55"/>
    <path d="M27.5 43 L31 46.3 L37.2 40.6" fill="none" stroke="#16A34A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g transform="translate(41 6)">
    <path d="M3 0 H17 Q20 0 20 3 V9 Q20 12 17 12 H8 L4.5 15 L5 12 H3 Q0 12 0 9 V3 Q0 0 3 0 Z" fill="#ffffff"/>
    <circle cx="5.5" cy="6" r="1.5" fill="#7C3AED"><animate attributeName="opacity" values="0.25;1;0.25;0.25" keyTimes="0;0.2;0.4;1" dur="1.5s" repeatCount="indefinite"/></circle>
    <circle cx="10" cy="6" r="1.5" fill="#7C3AED"><animate attributeName="opacity" values="0.25;0.25;1;0.25;0.25" keyTimes="0;0.2;0.4;0.6;1" dur="1.5s" repeatCount="indefinite"/></circle>
    <circle cx="14.5" cy="6" r="1.5" fill="#7C3AED"><animate attributeName="opacity" values="0.25;0.25;1;0.25" keyTimes="0;0.4;0.6;1" dur="1.5s" repeatCount="indefinite"/></circle>
  </g>
</svg>`;

const MASCOT_URI = `data:image/svg+xml;utf8,${encodeURIComponent(MASCOT_SVG)}`;

export default function LiaMascot({ size }: { size: number }) {
  return React.createElement('img', { src: MASCOT_URI, width: size, height: size, alt: 'Lia, assistente virtual do Lar em Dia', draggable: false, style: { display: 'block' } });
}
