import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { colors, radius, spacing } from '@/theme/tokens';

export function AppHeader({ eyebrow = 'P2P CAST', onHome }: { eyebrow?: string; onHome?: () => void }) {
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar ao início" onPress={onHome ?? (() => router.replace('/'))} style={styles.brand}>
        <View style={styles.mark} accessibilityElementsHidden>
          <View style={[styles.bar, styles.barOne]} />
          <View style={[styles.bar, styles.barTwo]} />
          <View style={[styles.bar, styles.barThree]} />
        </View>
        <Text style={styles.word}>p2p<Text style={styles.accent}>cast</Text></Text>
      </Pressable>
      <View style={styles.meta}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <View style={styles.dot} />
        <Text style={styles.note}>sem servidor de vídeo</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 24, height: 23, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  bar: { width: 5, borderRadius: radius.pill, backgroundColor: colors.cyan },
  barOne: { height: 11, opacity: 0.58 },
  barTwo: { height: 19 },
  barThree: { height: 14, opacity: 0.78 },
  word: { color: '#f1f7ff', fontSize: 18, fontWeight: '800', letterSpacing: -0.8 },
  accent: { color: colors.cyan },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrow: { color: colors.mutedBright, fontSize: 8, fontWeight: '800', letterSpacing: 1.1 },
  dot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.green },
  note: { color: colors.muted, fontSize: 8 },
});
