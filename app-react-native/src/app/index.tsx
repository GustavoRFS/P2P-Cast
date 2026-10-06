import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '@/theme/tokens';

function parseWatchTarget(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const appLink = value.match(/^p2pcast-react-native:\/\/watch\/([^?#]+)/i);
  if (appLink?.[1]) return decodeURIComponent(appLink[1]).trim() || null;

  const queryStart = value.indexOf('?');
  if (queryStart >= 0) {
    const query = value.slice(queryStart + 1).split('#', 1)[0];
    const parameter = query
      .split('&')
      .map((part) => part.split('=', 2))
      .find(([key]) => key === 'watch');
    if (!parameter?.[1]) return null;
    return decodeURIComponent(parameter[1].replace(/\+/g, ' ')).trim() || null;
  }

  return value.includes('://') ? null : value;
}

export default function HomeScreen() {
  const params = useLocalSearchParams<{ watch?: string | string[] }>();
  const watchParam = Array.isArray(params.watch) ? params.watch[0] : params.watch;
  const [watchInput, setWatchInput] = useState('');

  useEffect(() => {
    if (!watchParam) return;
    const peerId = parseWatchTarget(watchParam);
    if (peerId) {
      router.replace({ pathname: '/watch/[peerId]', params: { peerId } });
    }
  }, [watchParam]);

  const openViewer = () => {
    const peerId = parseWatchTarget(watchInput);
    if (!peerId) return;
    router.push({ pathname: '/watch/[peerId]', params: { peerId } });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.brandMark} accessibilityElementsHidden>
            <View style={[styles.markBar, styles.markOne]} />
            <View style={[styles.markBar, styles.markTwo]} />
            <View style={[styles.markBar, styles.markThree]} />
          </View>
          <Text style={styles.brand}>p2p<Text style={styles.brandAccent}>cast</Text></Text>
          <Text style={styles.headerNote}>SEM SERVIDOR DE VÍDEO</Text>
        </View>

        <View style={styles.hero}>
          <View style={styles.kicker}>
            <View style={styles.kickerDot} />
            <Text style={styles.kickerText}>CONEXÃO DIRETA ENTRE AMIGOS</Text>
          </View>
          <Text style={styles.title}>Compartilhe a tela.{ '\n' }<Text style={styles.titleAccent}>Fique na call.</Text></Text>
          <Text style={styles.description}>
            Uma transmissão simples para explicar aquela jogada, mostrar um bug ou acompanhar a partida com a galera.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => router.push('/broadcast')}
          >
            <Text style={styles.primaryButtonText}>Iniciar transmissão</Text>
            <Text style={styles.buttonArrow}>↗</Text>
          </Pressable>

          <View style={styles.watchPanel}>
            <Text style={styles.watchTitle}>Entrar em uma live</Text>
            <Text style={styles.watchDescription}>Cole o link ou digite o código da transmissão.</Text>
            <TextInput
              accessibilityLabel="Link ou código da transmissão"
              placeholder="https://…?watch= ou código"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              value={watchInput}
              onChangeText={setWatchInput}
              onSubmitEditing={openViewer}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !parseWatchTarget(watchInput) }}
              disabled={!parseWatchTarget(watchInput)}
              style={({ pressed }) => [styles.secondaryButton, !parseWatchTarget(watchInput) && styles.disabled, pressed && styles.pressed]}
              onPress={openViewer}
            >
              <Text style={styles.secondaryButtonText}>Assistir ao vivo</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.footer}>P2P CAST  ·  COMPARTILHE COM QUEM ESTÁ NA CALL</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xxl },
  header: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: { width: 25, height: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  markBar: { width: 5, borderRadius: radius.pill, backgroundColor: colors.cyan },
  markOne: { height: 11 },
  markTwo: { height: 21 },
  markThree: { height: 15 },
  brand: { color: colors.text, fontSize: 21, fontWeight: '800', letterSpacing: -1.1 },
  brandAccent: { color: colors.cyan },
  headerNote: { color: colors.muted, fontSize: 9, letterSpacing: 1.3, marginLeft: 'auto' },
  hero: { gap: spacing.lg, paddingTop: spacing.lg },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  kickerDot: { width: 7, height: 7, borderRadius: radius.pill, backgroundColor: colors.cyan },
  kickerText: { color: colors.cyan, fontSize: 10, fontWeight: '700', letterSpacing: 1.6 },
  title: { color: colors.text, fontSize: 38, lineHeight: 43, fontWeight: '800', letterSpacing: -1.8 },
  titleAccent: { color: colors.cyan },
  description: { maxWidth: 510, color: colors.muted, fontSize: 15, lineHeight: 23 },
  actions: { gap: spacing.lg },
  primaryButton: { minHeight: 56, paddingHorizontal: spacing.xl, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.cyan },
  primaryButtonText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  buttonArrow: { color: colors.onAccent, fontSize: 19, fontWeight: '700' },
  watchPanel: { padding: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: colors.panel, gap: spacing.md },
  watchTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  watchDescription: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  input: { minHeight: 48, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, color: colors.text, backgroundColor: colors.background, fontSize: 14 },
  secondaryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.panelRaised },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.82 },
  footer: { marginTop: 'auto', color: colors.muted, fontSize: 9, letterSpacing: 1.2, textAlign: 'center' },
});
