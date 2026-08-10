import { useRef, useState } from 'react';
import { Platform, ScrollView } from 'react-native';
import type { TourStep } from './FeatureTour';

// Toda a mecânica repetida do tour guiado por seção: abrir/fechar, rolar até
// a seção do passo atual e destacá-la. Cada tela só precisa: chamar este
// hook, colocar `ref={registerSection('chave')}` na View de cada seção, usar
// `isActive('chave') && styles.tourHighlight` no style dela, e renderizar
// <FeatureTour steps={...} visible={tourOpen} onClose={closeTour}
// onStepChange={step=>scrollToSection(step.key)} />.
export const useSectionTour = () => {
  const scrollRef = useRef<ScrollView>(null);
  const sectionRefs = useRef<Record<string, any>>({}).current;
  const [tourOpen, setTourOpen] = useState(false);
  const [activeTourKey, setActiveTourKey] = useState<string | null>(null);

  const registerSection = (key: string) => (node: any) => { if (node) sectionRefs[key] = node; };

  // Web: scrollIntoView do navegador — não depende de medir posição manual
  // (onLayout pode não ter disparado ainda quando o tour abre). Nativo: cai
  // pra measureLayout contra o ScrollView.
  const scrollToSection = (key: string) => {
    setActiveTourKey(key);
    const node = sectionRefs[key];
    if (!node) return;
    if (Platform.OS === 'web' && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (typeof node.measureLayout === 'function' && scrollRef.current) {
      const scrollNode = scrollRef.current as any;
      node.measureLayout(scrollNode, (_x: number, y: number) => { scrollNode.scrollTo?.({ y: Math.max(y - 16, 0), animated: true }); }, () => {});
    }
  };

  const openTour = () => setTourOpen(true);
  const closeTour = () => { setTourOpen(false); setActiveTourKey(null); };
  const isActive = (key: string) => tourOpen && activeTourKey === key;

  return { scrollRef, tourOpen, registerSection, scrollToSection, openTour, closeTour, isActive };
};

export type { TourStep };
