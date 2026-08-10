import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { colors, layout, shadow } from './theme';

// Rótulo sempre visível acima do campo: placeholder some assim que o usuário
// digita, e no celular vira impossível saber a que cada caixa corresponde.
export const Field = ({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}{required ? <Text style={styles.fieldRequired}> *</Text> : null}</Text>
    {children}
    {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
  </View>
);

export const TextField = ({ label, hint, required, style, ...props }: TextInputProps & { label: string; hint?: string; required?: boolean }) => (
  <Field label={label} hint={hint} required={required}>
    <TextInput placeholderTextColor={colors.placeholder} {...props} style={[styles.fieldInput, style]} />
  </Field>
);

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export const AppButton = ({ title, onPress, disabled, loading, variant = 'primary' }: ButtonProps) => (
  <Pressable
    onPress={onPress}
    disabled={disabled || loading}
    style={({ pressed }) => [
      styles.button,
      variant === 'secondary' && styles.secondaryButton,
      variant === 'danger' && styles.dangerButton,
      (disabled || loading) && styles.disabledButton,
      pressed && !disabled && !loading && styles.pressed,
    ]}
  >
    <View style={styles.buttonContent}>
      {loading ? <ActivityIndicator size="small" color="#fff" style={styles.buttonSpinner} /> : null}
      <Text style={[styles.buttonText, (disabled || loading) && styles.disabledButtonText]}>{title}</Text>
    </View>
  </Pressable>
);

export const Panel = ({ children }: { children: React.ReactNode }) => <View style={styles.panel}>{children}</View>;

export const EmptyState = ({ title, description }: { title: string; description: string }) => (
  <View style={styles.empty}>
    <Text style={styles.emptyTitle}>{title}</Text>
    <Text style={styles.emptyDescription}>{description}</Text>
  </View>
);

type DialogProps = {
  visible: boolean;
  title: string;
  message: string;
  tone?: 'info' | 'success' | 'error';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
  scrollable?: boolean;
};

export const AppDialog = ({ visible, title, message, tone = 'info', confirmLabel = 'Entendi', cancelLabel, onConfirm, onClose, scrollable = false }: DialogProps) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.dialogBackdrop}>
      <View style={[styles.dialogCard, scrollable && styles.dialogCardScrollable]}>
        <View style={[styles.dialogIcon, tone === 'success' && styles.dialogIconSuccess, tone === 'error' && styles.dialogIconError]}>
          <Text style={styles.dialogIconText}>{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</Text>
        </View>
        <Text style={styles.dialogTitle}>{title}</Text>
        {scrollable ? (
          <ScrollView style={styles.dialogMessageScroll}><Text style={[styles.dialogMessage, styles.dialogMessageLeft]}>{message}</Text></ScrollView>
        ) : (
          <Text style={styles.dialogMessage}>{message}</Text>
        )}
        <View style={styles.dialogActions}>
          {cancelLabel ? <Pressable onPress={onClose} style={styles.dialogCancel}><Text style={styles.dialogCancelText}>{cancelLabel}</Text></Pressable> : null}
          <Pressable onPress={onConfirm || onClose} style={[styles.dialogConfirm, tone === 'error' && styles.dialogConfirmError]}><Text style={styles.dialogConfirmText}>{confirmLabel}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  fieldLabel: { color: colors.ink, fontSize: 14.5, fontWeight: '800', marginBottom: 6 },
  fieldRequired: { color: colors.red },
  fieldHint: { color: colors.muted, fontSize: 13, lineHeight: 17, marginTop: 5 },
  fieldInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 9,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
    color: colors.ink,
  },
  button: {
    minHeight: 52,
    borderRadius: layout.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 2,
  },
  secondaryButton: {
    backgroundColor: colors.teal,
  },
  dangerButton: {
    backgroundColor: colors.red,
  },
  disabledButton: {
    backgroundColor: '#aeb9c7',
    shadowOpacity: 0,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.9,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSpinner: {
    marginRight: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  disabledButtonText: {
    color: '#f7f9fb',
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: layout.radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    ...shadow,
  },
  empty: {
    borderRadius: layout.radius,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    padding: 18,
    backgroundColor: '#fbfcfe',
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  emptyDescription: {
    color: colors.muted,
    lineHeight: 22,
    marginTop: 4,
  },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialogCard: { width: '100%', maxWidth: 430, borderRadius: 16, backgroundColor: '#fff', padding: 22, alignItems: 'center', ...shadow },
  dialogCardScrollable: { maxHeight: '80%' },
  dialogMessageScroll: { alignSelf: 'stretch', maxHeight: 280, marginTop: 9 },
  dialogMessageLeft: { textAlign: 'left', marginTop: 0 },
  dialogIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  dialogIconSuccess: { backgroundColor: colors.green },
  dialogIconError: { backgroundColor: colors.red },
  dialogIconText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  dialogTitle: { color: colors.ink, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  dialogMessage: { color: colors.muted, fontSize: 17, lineHeight: 22, textAlign: 'center', marginTop: 9 },
  dialogActions: { width: '100%', flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  dialogCancel: { minHeight: 52, paddingHorizontal: 18, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  dialogCancelText: { color: colors.ink, fontWeight: '800' },
  dialogConfirm: { minHeight: 52, paddingHorizontal: 18, borderRadius: 8, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dialogConfirmError: { backgroundColor: colors.red },
  dialogConfirmText: { color: '#fff', fontWeight: '900' },
});
