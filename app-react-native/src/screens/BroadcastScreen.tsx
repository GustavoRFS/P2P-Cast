import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { ChatPanel } from '@/components/ChatPanel';
import { PrimaryButton } from '@/components/PrimaryButton';
import { VideoStage } from '@/components/VideoStage';
import { DEFAULT_CAPTURE_SETTINGS, formatCaptureSettings, type CaptureSettings } from '@/domain/capture';
import { loadCaptureSettings, saveCaptureSettings } from '@/storage/preferences';
import { useBroadcastSession } from '@/session/useBroadcastSession';
import { colors, radius, spacing } from '@/theme/tokens';

export function BroadcastScreen() {
  const session = useBroadcastSession();
  const [settings, setSettings] = useState<CaptureSettings>(DEFAULT_CAPTURE_SETTINGS);
  const [settingsReady, setSettingsReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const started = useRef(false);
  const mounted = useRef(true);

  const startCapture = useCallback(async (captureSettings: CaptureSettings) => {
    setStartupError(null);
    try {
      await session.start(captureSettings);
    } catch (error) {
      if (mounted.current) setStartupError(error instanceof Error ? error.message : 'Não foi possível iniciar a transmissão.');
    }
  }, [session.start]);

  useEffect(() => {
    mounted.current = true;
    void loadCaptureSettings().then((saved) => {
      if (!mounted.current) return;
      setSettings(saved);
      setSettingsReady(true);
    });
    return () => {
      mounted.current = false;
      void session.stop();
    };
  }, [session.stop]);

  useEffect(() => {
    if (!settingsReady || started.current) return;
    started.current = true;
    void startCapture(settings);
  }, [settingsReady, settings, startCapture]);

  const endBroadcast = async () => {
    await session.stop();
    router.replace('/');
  };

  const shareLink = async () => {
    if (!session.shareUrl) return;
    await Share.share({ message: `Assista à minha transmissão ao vivo: ${session.shareUrl}`, url: session.shareUrl });
  };

  const flipCamera = () => {
    const nextFacing = settings.cameraFacing === 'user' ? 'environment' : 'user';
    const nextSettings = { ...settings, cameraFacing: nextFacing };
    setSettings(nextSettings);
    void saveCaptureSettings(nextSettings);
    void session.flipCamera();
  };

  const errorMessage = startupError ?? session.error?.message;
  const localVideoActive = session.tracks.screen || session.tracks.camera;
  const canControlMicrophone = session.sessionId !== null && session.mode !== 'error' && settings.source !== 'screen' && settings.microphone;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <AppHeader eyebrow="TRANSMISSOR" />
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text style={styles.kicker}>SUA TRANSMISSÃO</Text>
            <Text style={styles.title}>Mostre o que está acontecendo.</Text>
            <Text style={styles.description}>Mantenha este app aberto enquanto seus amigos entram pelo link.</Text>
          </View>
        </View>

        <VideoStage
          sessionId={session.sessionId}
          mode={session.mode}
          screenAvailable={session.tracks.screen}
          cameraAvailable={session.tracks.camera}
          local
          mirrorCamera={settings.cameraFacing === 'user'}
        />

        {errorMessage ? (
          <View style={styles.errorBox}>
            <View style={styles.errorMark}><Text style={styles.errorMarkText}>!</Text></View>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>{startupError ? 'Não foi possível iniciar' : 'A conexão precisa de atenção'}</Text>
              <Text style={styles.errorMessage}>{errorMessage}</Text>
              <Pressable accessibilityRole="button" onPress={() => { started.current = true; void startCapture(settings); }} style={styles.retryButton}>
                <Text style={styles.retryText}>Tentar novamente</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.videoMeta}>
          <Text style={styles.captureSummary}>{formatCaptureSettings(settings)}</Text>
          <Text style={styles.viewerCount}><Text style={styles.viewerIcon}>◉</Text> {session.viewerCount} {session.viewerCount === 1 ? 'pessoa' : 'pessoas'} assistindo</Text>
        </View>

        <View style={styles.shareCard}>
          <View>
            <Text style={styles.kicker}>CONVIDE A GALERA</Text>
            <Text style={styles.shareTitle}>O link é a sala.</Text>
            <Text style={styles.shareDescription}>Envie para quem vai assistir. Quando você encerrar, ele deixa de funcionar.</Text>
          </View>
          <View style={styles.linkBox}>
            <Text numberOfLines={1} style={styles.linkText}>{session.shareUrl ?? 'Gerando seu link…'}</Text>
          </View>
          <PrimaryButton title="Compartilhar link" icon="↗" onPress={() => void shareLink()} disabled={!session.shareUrl} />
          <View style={styles.tip}>
            <View style={styles.tipIcon}><Text style={styles.tipIconText}>i</Text></View>
            <Text style={styles.tipText}>A conexão de vídeo é feita diretamente entre os aparelhos. Deixe o app aberto durante a transmissão.</Text>
          </View>
        </View>

        {canControlMicrophone || session.tracks.camera ? (
          <View style={styles.controlRow}>
            {canControlMicrophone ? (
              <Pressable accessibilityRole="button" accessibilityState={{ selected: session.microphoneMuted }} onPress={() => void session.setMicrophoneMuted(!session.microphoneMuted)} style={styles.controlButton}>
                <Text style={styles.controlIcon}>{session.microphoneMuted ? '◖̸' : '◖'}</Text>
                <Text style={styles.controlText}>{session.microphoneMuted ? 'Ativar microfone' : 'Mutar microfone'}</Text>
              </Pressable>
            ) : null}
            {session.tracks.camera ? (
              <Pressable accessibilityRole="button" onPress={flipCamera} style={styles.controlButton}>
                <Text style={styles.controlIcon}>⟲</Text>
                <Text style={styles.controlText}>Inverter câmera</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <ChatPanel
          title="Chat com espectadores"
          messages={session.chatMessages}
          canSend={session.chatReady}
          onSend={(text) => session.sendChatMessage(text)}
          emptyLabel="Nenhuma mensagem ainda. Diga oi para quem está assistindo."
        />

        <View style={styles.footer}>
          <View style={styles.secureRow}><Text style={styles.secureIcon}>⌁</Text><Text style={styles.footerText}>Conexão WebRTC ponto a ponto</Text></View>
          <Pressable accessibilityRole="button" onPress={() => void endBroadcast()} style={styles.stopButton}>
            <Text style={styles.stopText}>Encerrar transmissão</Text><Text style={styles.stopIcon}>×</Text>
          </Pressable>
        </View>
        {!settingsReady && !localVideoActive ? <Text style={styles.loading}>Carregando suas configurações…</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 36, gap: spacing.md },
  heading: { marginBottom: 1 },
  headingCopy: { gap: 6 },
  kicker: { color: colors.cyan, fontSize: 8, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#f0f6ff', fontSize: 28, lineHeight: 32, fontWeight: '800', letterSpacing: -1.2 },
  description: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  videoMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: -5 },
  captureSummary: { flex: 1, color: '#718ca6', fontSize: 8, lineHeight: 13 },
  viewerCount: { color: '#718ca6', fontSize: 8, fontWeight: '700' },
  viewerIcon: { color: colors.cyan },
  shareCard: { gap: 12, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: '#0e1d31d9' },
  shareTitle: { marginTop: 5, color: '#eaf4ff', fontSize: 22, fontWeight: '800', letterSpacing: -1 },
  shareDescription: { marginTop: 6, color: colors.muted, fontSize: 10, lineHeight: 15 },
  linkBox: { minHeight: 41, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.sm, backgroundColor: '#75e5e00a' },
  linkText: { color: colors.cyan, fontSize: 10, fontWeight: '700' },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingTop: 11, borderTopWidth: 1, borderTopColor: colors.border },
  tipIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#91b7ff55', borderRadius: radius.pill },
  tipIconText: { color: colors.blue, fontSize: 9, fontWeight: '800' },
  tipText: { flex: 1, color: '#7890a8', fontSize: 9, lineHeight: 14 },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  controlButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#0e1d31' },
  controlIcon: { color: colors.cyan, fontSize: 15 },
  controlText: { color: colors.mutedBright, fontSize: 9, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 8 },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secureIcon: { color: colors.green, fontSize: 15 },
  footerText: { color: '#6f879f', fontSize: 8, fontWeight: '700' },
  stopButton: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  stopText: { color: '#93a9bd', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  stopIcon: { color: colors.danger, fontSize: 18 },
  errorBox: { flexDirection: 'row', gap: 10, padding: 12, borderWidth: 1, borderColor: '#ff98983b', borderRadius: radius.sm, backgroundColor: '#78243429' },
  errorMark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ff98986b', borderRadius: radius.pill },
  errorMarkText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  errorCopy: { flex: 1, gap: 4 },
  errorTitle: { color: '#ffdada', fontSize: 11, fontWeight: '800' },
  errorMessage: { color: '#d9aeb5', fontSize: 10, lineHeight: 15 },
  retryButton: { alignSelf: 'flex-start', paddingTop: 5 },
  retryText: { color: colors.cyan, fontSize: 9, fontWeight: '900' },
  loading: { color: colors.muted, fontSize: 9, textAlign: 'center' },
});
