import { StyleSheet, Text, View } from 'react-native';

import type { NativeSessionMode } from '../../modules/p2pcast-media/src/P2PCastMedia.types';
import { colors, radius, spacing } from '@/theme/tokens';

const LABELS: Record<NativeSessionMode, string> = {
  idle: 'Pronto para começar',
  starting: 'Preparando transmissão',
  broadcasting: 'Transmissão ativa',
  connecting: 'Conectando à transmissão',
  watching: 'Assistindo ao vivo',
  error: 'A conexão precisa de atenção',
};

export function StatusPill({ mode }: { mode: NativeSessionMode }) {
  const live = mode === 'broadcasting' || mode === 'watching';
  const tone = live ? colors.green : mode === 'error' ? colors.danger : colors.blue;
  return (
    <View style={[styles.pill, live && styles.live, mode === 'error' && styles.error]}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text numberOfLines={1} style={[styles.label, { color: tone }]}>{LABELS[mode]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 30, maxWidth: '100%', alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: '#ffffff06' },
  live: { borderColor: '#9ff1af38', backgroundColor: '#9ff1af0d' },
  error: { borderColor: '#ff989838', backgroundColor: '#ff98980d' },
  dot: { width: 6, height: 6, borderRadius: radius.pill },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 0.45 },
});
