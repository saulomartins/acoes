export const buildInitialPassword = (unitNumber: string, cpfDigits: string): string =>
  `${String(unitNumber).replace(/\D/g, '')}${cpfDigits.slice(0, 4)}`;

export const buildManagerInitialPassword = (cpfDigits: string): string => cpfDigits.slice(0, 6);
