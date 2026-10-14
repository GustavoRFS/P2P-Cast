import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

export function PrimaryButton({ title, onPress, disabled, loading, icon }: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
}) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.title}>{title}</Text>}
      {icon && !loading ? <View style={styles.icon}><Text style={styles.iconText}>{icon}</Text></View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: 19, borderRadius: radius.md, backgroundColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: 0.13, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  title: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  icon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: '#07111f' },
  iconText: { color: colors.cyan, fontSize: 18, lineHeight: 21 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
});
