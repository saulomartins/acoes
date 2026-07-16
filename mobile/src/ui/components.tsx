import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, layout, shadow } from './theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export const AppButton = ({ title, onPress, disabled, variant = 'primary' }: ButtonProps) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      styles.button,
      variant === 'secondary' && styles.secondaryButton,
      variant === 'danger' && styles.dangerButton,
      disabled && styles.disabledButton,
      pressed && !disabled && styles.pressed,
    ]}
  >
    <Text style={[styles.buttonText, disabled && styles.disabledButtonText]}>{title}</Text>
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
};

export const AppDialog = ({ visible, title, message, tone = 'info', confirmLabel = 'Entendi', cancelLabel, onConfirm, onClose }: DialogProps) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.dialogBackdrop}>
      <View style={styles.dialogCard}>
        <View style={[styles.dialogIcon, tone === 'success' && styles.dialogIconSuccess, tone === 'error' && styles.dialogIconError]}>
          <Text style={styles.dialogIconText}>{tone === 'success' ? '✓' : tone === 'error' ? '!' : 'i'}</Text>
        </View>
        <Text style={styles.dialogTitle}>{title}</Text>
        <Text style={styles.dialogMessage}>{message}</Text>
        <View style={styles.dialogActions}>
          {cancelLabel ? <Pressable onPress={onClose} style={styles.dialogCancel}><Text style={styles.dialogCancelText}>{cancelLabel}</Text></Pressable> : null}
          <Pressable onPress={onConfirm || onClose} style={[styles.dialogConfirm, tone === 'error' && styles.dialogConfirmError]}><Text style={styles.dialogConfirmText}>{confirmLabel}</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    borderRadius: layout.controlRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
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
  buttonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  disabledButtonText: {
    color: '#f7f9fb',
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: layout.radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
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
