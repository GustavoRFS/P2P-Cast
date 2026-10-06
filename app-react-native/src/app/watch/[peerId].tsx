import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { ViewerScreen } from '@/screens/ViewerScreen';
import { parseWatchTarget } from '@/domain/room';
import { colors, radius, spacing } from '@/theme/tokens';

export default function WatchRoute() {
  const params = useLocalSearchParams<{ peerId?: string | string[] }>();
  const rawPeerId = Array.isArray(params.peerId) ? params.peerId[0] : params.peerId;
  const broadcastId = rawPeerId ? parseWatchTarget(rawPeerId) : null;

  if (broadcastId) return <ViewerScreen key={broadcastId} broadcastId={broadcastId} />;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.page}>
        <AppHeader eyebrow="ESPECTADOR" onHome={() => router.replace('/')} />
        <View style={styles.content}>
          <View style={styles.mark}><Text style={styles.markText}>!</Text></View>
          <Text style={styles.title}>Link inválido</Text>
          <Text style={styles.description}>Volte ao início e cole um link ou código válido para entrar na transmissão.</Text>
          <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.button}><Text style={styles.buttonText}>Voltar ao início</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 720, flex: 1, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  mark: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ff98984a', borderRadius: radius.pill, backgroundColor: '#ff98980d' },
  markText: { color: colors.danger, fontSize: 19, fontWeight: '800' },
  title: { color: colors.text, fontSize: 23, fontWeight: '800', letterSpacing: -0.7 },
  description: { maxWidth: 300, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: 17, borderRadius: radius.sm, backgroundColor: colors.cyan },
  buttonText: { color: colors.onAccent, fontSize: 11, fontWeight: '900' },
});
