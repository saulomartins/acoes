import React from 'react';
import { View } from 'react-native';
import { useBreakpoint } from './responsive';

type ColumnsProp = { mobile?: number; tablet?: number; desktop?: number };

function useBasis(columns: ColumnsProp, fallback: number) {
  const { isMobile, isTablet } = useBreakpoint();
  const cols = isMobile ? (columns.mobile ?? fallback) : isTablet ? (columns.tablet ?? fallback) : (columns.desktop ?? fallback);
  return `${100 / cols}%`;
}

function Wrap({ children, columns, gap, alignItems }: { children: React.ReactNode; columns: ColumnsProp; gap: number; alignItems: 'stretch' | 'flex-start' }) {
  const basis = useBasis(columns, 1);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems, marginHorizontal: -gap / 2 }}>
      {React.Children.map(children, (child) => !child ? child : (
        <View style={{ flexBasis: basis as any, minWidth: 0, paddingHorizontal: gap / 2, marginBottom: gap }}>{child}</View>
      ))}
    </View>
  );
}

export const FormGrid = ({ children, columns = { mobile: 1, tablet: 2, desktop: 2 }, gap = 12 }:
  { children: React.ReactNode; columns?: ColumnsProp; gap?: number }) => <Wrap columns={columns} gap={gap} alignItems="flex-start">{children}</Wrap>;

export const FormFieldFull = ({ children }: { children: React.ReactNode }) => <View style={{ width: '100%' }}>{children}</View>;

export const CardGrid = ({ children, columns = { mobile: 1, tablet: 2, desktop: 3 }, gap = 12 }:
  { children: React.ReactNode; columns?: ColumnsProp; gap?: number }) => <Wrap columns={columns} gap={gap} alignItems="stretch">{children}</Wrap>;
