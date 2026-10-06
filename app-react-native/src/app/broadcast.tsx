import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme/tokens';

export default function BroadcastScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>‹  Voltar</Text>
      </Pressable>
      <View style={styles.content}>
        <View style={styles.status}><View style={styles.statusDot} /><Text style={styles.statusText}>PRONTO PARA COMEÇAR</Text></View>
        <Text style={styles.title}>Prepare a transmissão</Text>
        <Text style={styles.description}>
          Escolha tela, câmera ou as duas fontes. O Android solicitará as permissões necessárias antes de iniciar.
        </Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Controles de captura</Text>
          <Text style={styles.noticeText}>As opções de resolução, áudio e câmera serão exibidas aqui.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl, paddingTop: spacing.lg },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  backText: { color: colors.cyan, fontSize: 15, fontWeight: '600' },
  content: { flex: 1, justifyContent: 'center', gap: spacing.lg, paddingBottom: spacing.xxxl },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.cyan },
  statusText: { color: colors.cyan, fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -1 },
  description: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  notice: { marginTop: spacing.sm, padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.panel, gap: spacing.sm },
  noticeTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  noticeText: { color: colors.muted, fontSize: 13, lineHeight: 20 },
});
