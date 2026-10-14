import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { ChatPanel } from '@/components/ChatPanel';
import { VideoStage } from '@/components/VideoStage';
import { useViewerSession } from '@/session/useViewerSession';
import { colors, radius, spacing } from '@/theme/tokens';

export function ViewerScreen({ broadcastId }: { broadcastId: string }) {
  const session = useViewerSession(broadcastId);
  const [pipUnavailable, setPipUnavailable] = useState(false);
  const hasVideo = session.tracks.screen || session.tracks.camera;

  const leave = useCallback(async () => {
    await session.leave();
    router.replace('/');
  }, [session.leave]);

  const activatePip = async () => {
    setPipUnavailable(false);
    const entered = await session.enterPictureInPicture();
    if (!entered) setPipUnavailable(true);
  };

  const toggleAudio = () => { void session.setAudioEnabled(!session.audioEnabled); };
  const changeVolume = (amount: number) => { void session.setVolume(session.volume + amount); };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        {!session.isInPictureInPictureMode ? <AppHeader eyebrow="ESPECTADOR" onHome={() => void leave()} /> : null}
        {!session.isInPictureInPictureMode ? (
          <View style={styles.heading}>
            <Text style={styles.kicker}>SALA COMPARTILHADA</Text>
            <Text style={styles.title}>Você entrou na transmissão.</Text>
            <Text style={styles.description}>A imagem vem direto do aparelho de quem está transmitindo.</Text>
          </View>
        ) : null}

        <VideoStage
          sessionId={session.sessionId}
          mode={session.mode}
          screenAvailable={session.tracks.screen}
          cameraAvailable={session.tracks.camera}
          local={false}
        />

        {session.error || session.connectionError ? (
          <View style={styles.errorBox}>
            <View style={styles.errorMark}><Text style={styles.errorMarkText}>!</Text></View>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>A conexão precisa de atenção</Text>
              <Text style={styles.errorMessage}>{session.connectionError ?? session.error?.message}</Text>
              <Pressable accessibilityRole="button" onPress={() => void session.retry()} style={styles.retryButton}><Text style={styles.retryText}>Tentar novamente</Text></Pressable>
            </View>
          </View>
        ) : null}

        {pipUnavailable ? <Text style={styles.inlineNotice}>O modo PiP não está disponível agora. Continue assistindo nesta tela.</Text> : null}

        {!session.isInPictureInPictureMode ? (
          <>
            <View style={styles.toolbar}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: session.audioEnabled }} onPress={toggleAudio} disabled={!hasVideo} style={[styles.audioButton, !hasVideo && styles.disabled]}>
                <Text style={styles.audioIcon}>{session.audioEnabled ? '◖' : '◖̸'}</Text>
                <Text style={styles.audioText}>{session.audioEnabled ? 'Mutar áudio' : 'Ativar áudio'}</Text>
              </Pressable>
              {hasVideo ? (
                <Pressable accessibilityRole="button" onPress={() => void activatePip()} style={styles.pipButton}>
                  <Text style={styles.pipIcon}>▣</Text><Text style={styles.pipText}>PiP</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.volumeCard}>
              <View style={styles.volumeHeading}><Text style={styles.volumeLabel}>VOLUME DA TRANSMISSÃO</Text><Text style={styles.volumePercent}>{Math.round(session.volume * 100)}%</Text></View>
              <View style={styles.volumeRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="Diminuir volume" onPress={() => changeVolume(-0.1)} style={styles.volumeStep}><Text style={styles.volumeStepText}>−</Text></Pressable>
                <View style={styles.volumeTrack}>
                  <View style={[styles.volumeFill, { width: `${session.volume * 100}%` }]} />
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Aumentar volume" onPress={() => changeVolume(0.1)} style={styles.volumeStep}><Text style={styles.volumeStepText}>+</Text></Pressable>
              </View>
            </View>

            <ChatPanel
              title="Chat com quem está assistindo"
              messages={session.chatMessages}
              canSend={session.chatReady}
              onSend={(text) => session.sendChatMessage(text)}
              emptyLabel="Nenhuma mensagem ainda. Mande um oi."
              viewerName={session.viewerName}
              onViewerNameChange={session.setName}
            />

            <View style={styles.footer}>
              <View style={styles.secureRow}><Text style={styles.secureIcon}>⌁</Text><Text style={styles.footerText}>Conexão WebRTC criptografada</Text></View>
              <Pressable accessibilityRole="button" onPress={() => void leave()} style={styles.leaveButton}><Text style={styles.leaveText}>Sair da sala</Text><Text style={styles.leaveIcon}>×</Text></Pressable>
            </View>
            <Text numberOfLines={1} style={styles.peerId}>ID  {broadcastId}</Text>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: 36, gap: spacing.md },
  heading: { gap: 6, marginTop: spacing.sm },
  kicker: { color: colors.cyan, fontSize: 8, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#f0f6ff', fontSize: 25, lineHeight: 30, fontWeight: '800', letterSpacing: -1 },
  description: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioButton: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.sm, backgroundColor: colors.cyan },
  audioIcon: { color: colors.onAccent, fontSize: 15 },
  audioText: { color: colors.onAccent, fontSize: 10, fontWeight: '900' },
  pipButton: { minWidth: 67, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#75e5e055', borderRadius: radius.sm, backgroundColor: '#75e5e012' },
  pipIcon: { color: colors.cyan, fontSize: 14 },
  pipText: { color: colors.cyan, fontSize: 10, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  volumeCard: { gap: 9, paddingHorizontal: 12, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#0e1d31' },
  volumeHeading: { flexDirection: 'row', justifyContent: 'space-between' },
  volumeLabel: { color: colors.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.75 },
  volumePercent: { color: colors.cyan, fontSize: 9, fontWeight: '900' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  volumeStep: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: '#ffffff07' },
  volumeStepText: { color: colors.mutedBright, fontSize: 17, lineHeight: 20 },
  volumeTrack: { height: 5, flex: 1, overflow: 'hidden', borderRadius: radius.pill, backgroundColor: '#263d53' },
  volumeFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.cyan },
  errorBox: { flexDirection: 'row', gap: 10, padding: 12, borderWidth: 1, borderColor: '#ff98983b', borderRadius: radius.sm, backgroundColor: '#78243429' },
  errorMark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ff98986b', borderRadius: radius.pill },
  errorMarkText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  errorCopy: { flex: 1, gap: 4 },
  errorTitle: { color: '#ffdada', fontSize: 11, fontWeight: '800' },
  errorMessage: { color: '#d9aeb5', fontSize: 10, lineHeight: 15 },
  retryButton: { alignSelf: 'flex-start', paddingTop: 5 },
  retryText: { color: colors.cyan, fontSize: 9, fontWeight: '900' },
  inlineNotice: { padding: 10, borderWidth: 1, borderColor: '#91b7ff38', borderRadius: radius.sm, color: colors.mutedBright, backgroundColor: '#91b7ff0c', fontSize: 9, lineHeight: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 5 },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  secureIcon: { color: colors.green, fontSize: 15 },
  footerText: { color: '#6f879f', fontSize: 8, fontWeight: '700' },
  leaveButton: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leaveText: { color: '#93a9bd', fontSize: 8, fontWeight: '800' },
  leaveIcon: { color: colors.danger, fontSize: 18 },
  peerId: { color: '#596f84', fontSize: 8, textAlign: 'center' },
});
