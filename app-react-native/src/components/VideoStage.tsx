import { StyleSheet, Text, View } from 'react-native';

import { StatusPill } from '@/components/StatusPill';
import type { CaptureTrackSource } from '@/domain/capture';
import type { NativeSessionMode } from '../../modules/p2pcast-media/src/P2PCastMedia.types';
import { P2PCastVideoView } from '../../modules/p2pcast-media';
import { colors, radius, spacing } from '@/theme/tokens';

export function VideoStage({ sessionId, mode, screenAvailable, cameraAvailable, local, mirrorCamera = true }: {
  sessionId: string | null;
  mode: NativeSessionMode;
  screenAvailable: boolean;
  cameraAvailable: boolean;
  local: boolean;
  mirrorCamera?: boolean;
}) {
  const source: CaptureTrackSource | null = screenAvailable ? 'screen' : cameraAvailable ? 'camera' : null;
  const hasBoth = screenAvailable && cameraAvailable;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>{local ? 'PRÉVIA LOCAL' : 'TRANSMISSÃO AO VIVO'}</Text>
          <Text style={styles.headerDetail}>{local ? 'Seu vídeo aparece apenas para você' : 'Conexão ponto a ponto'}</Text>
        </View>
        <StatusPill mode={mode} />
      </View>
      <View style={styles.stage}>
        {source && sessionId ? (
          <P2PCastVideoView
            key={`${sessionId}-${source}`}
            sessionId={sessionId}
            source={source}
            scaleMode={source === 'camera' ? 'cover' : 'contain'}
            mirror={local && source === 'camera' && mirrorCamera}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={styles.placeholder}>
            <View style={styles.placeholderGlyph}><Text style={styles.glyph}>{mode === 'starting' || mode === 'connecting' ? '◌' : '⌁'}</Text></View>
            <Text style={styles.placeholderTitle}>{mode === 'error' ? 'O vídeo não está disponível' : local ? 'Aguardando a captura…' : 'Aguardando o vídeo…'}</Text>
            <Text style={styles.placeholderDetail}>{mode === 'error' ? 'Tente novamente ou volte ao início.' : mode === 'watching' ? 'A outra fonte de vídeo ainda não foi recebida.' : 'A imagem aparecerá aqui quando a conexão estiver pronta.'}</Text>
          </View>
        )}
        {hasBoth && sessionId ? (
          <View style={styles.cameraOverlay}>
            <P2PCastVideoView sessionId={sessionId} source="camera" scaleMode="cover" mirror={local && mirrorCamera} style={StyleSheet.absoluteFill} />
          </View>
        ) : null}
        {source ? <View pointerEvents="none" style={styles.liveBadge}><View style={styles.liveDot} /><Text style={styles.liveText}>{local ? 'LOCAL' : 'AO VIVO'}</Text></View> : null}
      </View>
      {hasBoth ? <Text style={styles.sourceNote}>TELA + CÂMERA · A CÂMERA APARECE EM MINIATURA</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, backgroundColor: '#0e1d31d9', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 2 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 2, paddingBottom: 10 },
  headerCopy: { flex: 1, gap: 4 },
  kicker: { color: '#8fa8c0', fontSize: 8, fontWeight: '900', letterSpacing: 1.05 },
  headerDetail: { color: '#718ca6', fontSize: 9 },
  stage: { width: '100%', aspectRatio: 16 / 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(164,213,255,0.12)', borderRadius: radius.sm, backgroundColor: colors.videoStage },
  placeholder: { maxWidth: 250, alignItems: 'center', gap: 8, padding: spacing.lg },
  placeholderGlyph: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.pill, backgroundColor: '#75e5e00d' },
  glyph: { color: colors.cyan, fontSize: 24 },
  placeholderTitle: { color: colors.mutedBright, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  placeholderDetail: { color: colors.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  liveBadge: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#9ff1af38', borderRadius: 6, backgroundColor: '#05141cb3' },
  liveDot: { width: 5, height: 5, borderRadius: radius.pill, backgroundColor: colors.green },
  liveText: { color: colors.green, fontSize: 7, fontWeight: '900', letterSpacing: 1 },
  cameraOverlay: { position: 'absolute', right: 10, bottom: 10, width: '27%', aspectRatio: 9 / 16, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(175,244,240,0.48)', borderRadius: 9, backgroundColor: colors.videoStage, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 12, elevation: 5 },
  sourceNote: { marginTop: 9, color: '#718ca6', fontSize: 7, fontWeight: '800', letterSpacing: 0.6 },
});
