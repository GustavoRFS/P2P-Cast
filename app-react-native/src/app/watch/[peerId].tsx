import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme/tokens';

export default function ViewerScreen() {
  const { peerId } = useLocalSearchParams<{ peerId: string }>();
  const validPeerId = typeof peerId === 'string' ? peerId.trim() : '';

  return (
    <SafeAreaView style={styles.page}>
      <Pressable accessibilityRole="button" onPress={() => router.replace('/')} style={styles.backButton}>
        <Text style={styles.backText}>‹  Início</Text>
      </Pressable>
      <View style={styles.content}>
        <View style={styles.stage}>
          <View style={styles.status}><View style={styles.statusDot} /><Text style={styles.statusText}>CONECTANDO À TRANSMISSÃO</Text></View>
          <Text style={styles.stageTitle}>{validPeerId ? 'Preparando o vídeo' : 'Link inválido'}</Text>
          <Text style={styles.stageDescription}>
            {validPeerId ? 'A imagem aparecerá aqui assim que a conexão direta estiver pronta.' : 'Volte ao início e cole um link ou código válido.'}
          </Text>
        </View>
        {validPeerId ? <Text numberOfLines={1} style={styles.peerId}>ID  {validPeerId}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  backText: { color: colors.cyan, fontSize: 15, fontWeight: '600' },
  content: { flex: 1, justifyContent: 'center', gap: spacing.md, paddingBottom: spacing.xxxl },
  stage: { width: '100%', aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: '#030a12', gap: spacing.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.cyan },
  statusText: { color: colors.cyan, fontSize: 9, fontWeight: '700', letterSpacing: 1.1 },
  stageTitle: { color: colors.text, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  stageDescription: { maxWidth: 380, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  peerId: { color: colors.muted, fontSize: 11, textAlign: 'center' },
});
