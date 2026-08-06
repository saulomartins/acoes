import { useWindowDimensions } from 'react-native';

export const BREAKPOINTS = { tablet: 760, desktop: 1200, wide: 1600 } as const;

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
  const isMobile = width < BREAKPOINTS.tablet;
  const isTablet = width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isDesktop = width >= BREAKPOINTS.desktop;
  const isWide = width >= BREAKPOINTS.wide;
  const atLeastTablet = width >= BREAKPOINTS.tablet;
  return { width, height, isMobile, isTablet, isDesktop, isWide, atLeastTablet };
}
