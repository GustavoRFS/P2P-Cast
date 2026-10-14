import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { CaptureSettingsPanel } from '@/components/CaptureSettingsPanel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { parseWatchTarget } from '@/domain/room';
import { DEFAULT_CAPTURE_SETTINGS, formatCaptureSettings, type CaptureSettings } from '@/domain/capture';
import { loadCaptureSettings, saveCaptureSettings } from '@/storage/preferences';
import { colors, radius, spacing } from '@/theme/tokens';

export default function HomeScreen() {
  const params = useLocalSearchParams<{ watch?: string | string[] }>();
  const watchParam = Array.isArray(params.watch) ? params.watch[0] : params.watch;
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [watchInput, setWatchInput] = useState('');
  const [invalidWatch, setInvalidWatch] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadCaptureSettings().then((stored) => { if (mounted) setSettings(stored); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!watchParam) return;
    const peerId = parseWatchTarget(watchParam);
    if (peerId) router.replace({ pathname: '/watch/[peerId]', params: { peerId } });
  }, [watchParam]);

  const updateSettings = useCallback((next: CaptureSettings) => {
    setSettings(next);
    void saveCaptureSettings(next);
  }, []);

  const openViewer = () => {
    const peerId = parseWatchTarget(watchInput);
    setInvalidWatch(!peerId);
    if (peerId) router.push({ pathname: '/watch/[peerId]', params: { peerId } });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AppHeader />

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

        <View style={styles.previewCard}>
          <View style={styles.previewTop}>
            <View style={styles.liveLabel}><View style={styles.liveDot} /><Text style={styles.liveText}>AO VIVO</Text></View>
            <Text style={styles.previewTime}>00:42:18</Text>
          </View>
          <View style={styles.fakeScreen}>
            <View style={styles.screenGlow} />
            <View style={styles.screenLines}><View style={styles.screenLine} /><View style={[styles.screenLine, styles.screenLineShort]} /><View style={[styles.screenLine, styles.screenLineShorter]} /></View>
            <View style={styles.p2pBadge}><Text style={styles.p2pText}>P2P</Text></View>
            <View style={styles.signalBars}><View style={[styles.signalBar, styles.signalBarOne]} /><View style={[styles.signalBar, styles.signalBarTwo]} /><View style={[styles.signalBar, styles.signalBarThree]} /><View style={[styles.signalBar, styles.signalBarFour]} /></View>
          </View>
          <View style={styles.previewBottom}>
            <Text style={styles.previewBottomText}>COMPARTILHAMENTO DIRETO</Text>
            <Text style={styles.previewBottomText}>WEBRTC · PRIVADO</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <CaptureSettingsPanel settings={settings} screenAudioAvailable={false} onChange={updateSettings} />
          <PrimaryButton title="Iniciar transmissão" icon="↗" onPress={() => {
            void saveCaptureSettings(settings).then(() => router.push('/broadcast'));
          }} />
          <Text style={styles.microcopy}><Text style={styles.microcopyAccent}>⌁</Text> SEM LOGIN · FEITO PARA POUCOS AMIGOS</Text>
        </View>

        <View style={styles.watchPanel}>
          <View style={styles.watchHeading}>
            <View>
              <Text style={styles.watchTitle}>Entrar em uma live</Text>
              <Text style={styles.watchDescription}>Cole o link ou digite o código da transmissão.</Text>
            </View>
            <View style={styles.watchIcon}><Text style={styles.watchIconText}>↗</Text></View>
          </View>
          <TextInput
            accessibilityLabel="Link ou código da transmissão"
            placeholder="https://…?watch= ou código"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            value={watchInput}
            onChangeText={(value) => { setWatchInput(value); setInvalidWatch(false); }}
            onSubmitEditing={openViewer}
            style={[styles.input, invalidWatch && styles.inputError]}
          />
          {invalidWatch ? <Text style={styles.validation}>Cole um link válido ou informe o código da live.</Text> : null}
          <Pressable accessibilityRole="button" onPress={openViewer} style={({ pressed }) => [styles.watchButton, pressed && styles.pressed]}>
            <Text style={styles.watchButtonText}>Assistir ao vivo</Text>
            <Text style={styles.watchButtonArrow}>→</Text>
          </Pressable>
        </View>

        <View style={styles.features}>
          <Feature icon="⌁" title="Ponto a ponto" detail="Vídeo direto entre vocês" />
          <Feature icon="◉" title="Tela e câmera" detail="Escolha o que compartilhar" />
          <Feature icon="↗" title="Um link" detail="Convide a galera para a sala" />
        </View>
        <Text style={styles.footer}>P2P CAST  ·  {formatCaptureSettings(settings).toUpperCase()}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Feature({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}><Text style={styles.featureIconText}>{icon}</Text></View>
      <View style={styles.featureCopy}><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureDetail}>{detail}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 36, gap: spacing.xl },
  hero: { gap: spacing.md, paddingTop: spacing.md },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  kickerDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.green, shadowColor: colors.green, shadowOpacity: 0.45, shadowRadius: 6 },
  kickerText: { color: colors.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.55 },
  title: { color: '#f0f6ff', fontSize: 40, lineHeight: 43, fontWeight: '800', letterSpacing: -2.3 },
  titleAccent: { color: colors.cyan },
  description: { maxWidth: 470, color: colors.mutedBright, fontSize: 14, lineHeight: 22 },
  previewCard: { padding: 13, borderWidth: 1, borderColor: 'rgba(170,218,255,0.18)', borderRadius: radius.lg, backgroundColor: '#0d2034', transform: [{ rotate: '1.1deg' }], shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 4 },
  previewTop: { height: 27, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 4 },
  liveLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  previewTime: { color: '#7893ad', fontSize: 9, fontVariant: ['tabular-nums'] },
  fakeScreen: { height: 164, overflow: 'hidden', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(152,219,255,0.13)', borderRadius: radius.sm, backgroundColor: '#112946' },
  screenGlow: { position: 'absolute', width: 150, height: 150, left: '22%', top: 10, borderRadius: radius.pill, backgroundColor: '#69ecd42a' },
  screenLines: { width: 120, gap: 11, marginLeft: '15%' },
  screenLine: { height: 7, width: '100%', borderRadius: radius.pill, backgroundColor: '#e2ffff8f' },
  screenLineShort: { width: '78%', backgroundColor: '#a7e5fc61' },
  screenLineShorter: { width: '58%', backgroundColor: '#a7e5fc3d' },
  p2pBadge: { position: 'absolute', right: 24, bottom: 21, width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#aff4f06b', borderRadius: 11, backgroundColor: '#0616269e' },
  p2pText: { color: colors.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  signalBars: { position: 'absolute', right: 26, top: 22, height: 13, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  signalBar: { width: 3, borderRadius: radius.pill, backgroundColor: colors.cyan },
  signalBarOne: { height: 4, opacity: 0.36 },
  signalBarTwo: { height: 7, opacity: 0.58 },
  signalBarThree: { height: 10, opacity: 0.78 },
  signalBarFour: { height: 13 },
  previewBottom: { height: 24, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 },
  previewBottomText: { color: '#7090a8', fontSize: 7, fontWeight: '800', letterSpacing: 0.7 },
  actions: { gap: spacing.md, marginTop: 1 },
  microcopy: { marginLeft: 2, color: '#718ba4', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  microcopyAccent: { color: colors.cyan, fontSize: 14 },
  watchPanel: { gap: spacing.md, padding: 17, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: '#0e1d31d9' },
  watchHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  watchTitle: { color: colors.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.25 },
  watchDescription: { marginTop: 5, color: colors.muted, fontSize: 11, lineHeight: 16 },
  watchIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.sm, backgroundColor: '#75e5e00d' },
  watchIconText: { color: colors.cyan, fontSize: 16 },
  input: { minHeight: 46, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text, backgroundColor: '#071421', fontSize: 12 },
  inputError: { borderColor: '#ff989880' },
  validation: { marginTop: -8, color: colors.danger, fontSize: 10 },
  watchButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#132a44' },
  watchButtonText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  watchButtonArrow: { color: colors.cyan, fontSize: 18 },
  pressed: { opacity: 0.78 },
  features: { gap: 12, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  featureIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.sm, backgroundColor: '#75e5e00d' },
  featureIconText: { color: colors.cyan, fontSize: 15 },
  featureCopy: { gap: 2 },
  featureTitle: { color: '#cedded', fontSize: 10, fontWeight: '800' },
  featureDetail: { color: '#6c849b', fontSize: 9 },
  footer: { color: '#5f7890', fontSize: 7, fontWeight: '700', letterSpacing: 0.7, textAlign: 'center' },
});
