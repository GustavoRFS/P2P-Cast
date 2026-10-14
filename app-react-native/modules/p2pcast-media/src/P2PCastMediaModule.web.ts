import { NativeModule, registerWebModule } from 'expo';
import Peer from 'peerjs';
import type { DataConnection, MediaConnection, Peer as PeerInstance } from 'peerjs';

import { getCaptureTracks, RESOLUTION_OPTIONS, type CaptureSettings, type CaptureTrackSource } from '@/domain/capture';
import {
  buildChatMessage,
  CHAT_CONNECTION_ROLE,
  resolveAuthorName,
  sanitizeChatName,
  sanitizeChatText,
  type ChatMessage,
} from '@/domain/chat';
import { buildWatchUrl } from '@/domain/room';
import {
  clearWebVideoSession,
  emitPictureInPictureChange,
  getWebVideoElement,
  setWebVideoStream,
  setWebViewerAudio,
  subscribeToPictureInPicture,
} from './P2PCastMediaWebViewStore';
import type {
  CapturePermissionResult,
  P2PCastMediaApi,
  P2PCastMediaModuleEvents,
  StartViewerOptions,
} from './P2PCastMedia.types';

const PEER_OPTIONS = {
  host: 'peerjs.ligmacharl.es',
  port: 443,
  path: '/peerjs',
  key: 'peerjs',
  secure: true,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] },
  debug: 0,
};

const MAX_MEDIA_CONNECTIONS_PER_SESSION = 2;
const VIEWER_CONNECTION_TIMEOUT_MS = 25_000;

type CaptureStreams = Partial<Record<CaptureTrackSource, MediaStream>>;

type PendingCapture = {
  settings: CaptureSettings;
  streams: CaptureStreams;
};

type BroadcastCall = {
  call: MediaConnection;
  source: CaptureTrackSource;
  viewerId: string;
  viewerSessionId: string;
};

type BaseSession = {
  id: string;
  peer: PeerInstance;
  timeout?: ReturnType<typeof setTimeout>;
  chatConnections: Set<DataConnection>;
};

type BroadcastSession = BaseSession & {
  kind: 'broadcast';
  streams: CaptureStreams;
  settings: CaptureSettings;
  peerId?: string;
  calls: Set<BroadcastCall>;
  chatViewerIndex: number;
};

type ViewerSession = BaseSession & {
  kind: 'viewer';
  options: StartViewerOptions;
  mediaCalls: Partial<Record<CaptureTrackSource, MediaConnection>>;
  negotiationStreams: MediaStream[];
  remoteStreams: CaptureStreams;
  settledSources: Set<CaptureTrackSource>;
  receivedSources: Set<CaptureTrackSource>;
  audioEnabled: boolean;
  volume: number;
};

type ActiveSession = BroadcastSession | ViewerSession;

type WebkitVideoElement = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: 'inline' | 'picture-in-picture') => void;
  webkitPresentationMode?: string;
};

let pendingCapture: PendingCapture | null = null;
let captureRequestGeneration = 0;

function createSessionId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

function stopStreams(streams: CaptureStreams) {
  Object.values(streams).forEach(stopStream);
}

function getResolution(settings: CaptureSettings) {
  return RESOLUTION_OPTIONS.find((option) => option.value === settings.resolution);
}

function getVideoConstraints(settings: CaptureSettings): MediaTrackConstraints {
  const resolution = getResolution(settings);
  return {
    ...(resolution?.width && resolution.height
      ? { width: { ideal: resolution.width }, height: { ideal: resolution.height } }
      : {}),
    frameRate: { ideal: settings.fps },
  };
}

function getDisplayMediaOptions(settings: CaptureSettings): DisplayMediaStreamOptions {
  return { video: getVideoConstraints(settings), audio: settings.screenAudio };
}

function getCameraMediaOptions(settings: CaptureSettings): MediaStreamConstraints {
  return {
    video: { ...getVideoConstraints(settings), facingMode: { ideal: settings.cameraFacing } },
    audio: settings.microphone,
  };
}

function getCaptureErrorMessage(error: unknown, source: CaptureTrackSource) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return source === 'camera'
      ? 'A permissão da câmera ou do microfone foi recusada. Permita o acesso no navegador e tente novamente.'
      : 'O compartilhamento foi cancelado ou a permissão foi recusada. Clique em transmitir e escolha uma tela ou janela.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return source === 'camera'
      ? 'Não foi encontrada uma câmera ou um microfone disponível para esta transmissão.'
      : 'O navegador não encontrou uma tela ou janela para compartilhar.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return source === 'camera'
      ? 'O navegador não conseguiu acessar a câmera ou o microfone. Feche outro app que esteja usando o dispositivo e tente novamente.'
      : 'O navegador não conseguiu acessar a tela. Tente compartilhar outra janela ou tela.';
  }
  if (name === 'TypeError' || name === 'SecurityError') {
    return 'Este navegador não oferece suporte à captura solicitada. A captura precisa de um navegador compatível em uma conexão segura (HTTPS).';
  }
  return error instanceof Error ? error.message : 'Não foi possível obter acesso à fonte de mídia.';
}

function peerErrorMessage(error: unknown, action: 'broadcast' | 'viewer') {
  const type = typeof error === 'object' && error !== null && 'type' in error
    ? String((error as { type?: unknown }).type)
    : '';
  if (type === 'peer-unavailable') {
    return 'A transmissão não está disponível. Confira o link e tente novamente.';
  }
  if (type === 'unavailable-id' || type === 'invalid-id') {
    return 'O código desta transmissão não é válido. Confira o link e tente novamente.';
  }
  if (type === 'network' || type === 'socket-error' || type === 'server-error') {
    return 'Não foi possível conectar ao servidor de sinalização. Confira a conexão e tente novamente.';
  }
  return action === 'viewer'
    ? 'Não foi possível conectar à transmissão. Confira o link e tente novamente.'
    : 'Não foi possível iniciar a transmissão. Tente novamente.';
}

function metadataString(metadata: unknown, key: string, fallback: string) {
  if (typeof metadata !== 'object' || metadata === null || !(key in metadata)) return fallback;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : fallback;
}

function getMediaIdentity(peerId: string, metadata: unknown) {
  return metadataString(metadata, 'viewerId', `peer:${peerId}`);
}

function getViewerSessionIdentity(peerId: string, metadata: unknown) {
  return metadataString(metadata, 'viewerSessionId', `peer:${peerId}`);
}

function parseData(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data);
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof data === 'object' && data !== null ? data as Record<string, unknown> : null;
}

function createNegotiationStream() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const videoStream = canvas.captureStream(1);
  const tracks = [...videoStream.getVideoTracks()];
  let audioContext: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  const AudioContextConstructor = window.AudioContext
    ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (AudioContextConstructor) {
    try {
      audioContext = new AudioContextConstructor();
      oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const destination = audioContext.createMediaStreamDestination();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(destination);
      oscillator.start();
      tracks.push(...destination.stream.getAudioTracks());
    } catch {
      void audioContext?.close();
      audioContext = null;
      oscillator = null;
    }
  }

  const stream = new MediaStream(tracks);
  return {
    stream,
    dispose() {
      stream.getTracks().forEach((track) => track.stop());
      videoStream.getTracks().forEach((track) => track.stop());
      try {
        oscillator?.stop();
      } catch {
        // A negotiation stream may already have been disposed.
      }
      void audioContext?.close();
    },
  };
}

class P2PCastMediaModule extends NativeModule<P2PCastMediaModuleEvents> implements P2PCastMediaApi {
  private activeSession: ActiveSession | null = null;
  private lastSessionId: string | null = null;
  private lastViewerOptions: StartViewerOptions | null = null;
  private lastViewerSessionId: string | null = null;
  private retrySessionId: string | null = null;

  async requestCapturePermissions(settings: CaptureSettings): Promise<CapturePermissionResult> {
    const generation = ++captureRequestGeneration;
    this.stopSessionNow();
    const oldCapture = pendingCapture;
    pendingCapture = null;
    stopStreams(oldCapture?.streams ?? {});

    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return {
        granted: false,
        screenCaptureGranted: false,
        cameraGranted: false,
        microphoneGranted: false,
        screenAudioAvailable: false,
        reason: 'Este navegador não disponibiliza captura de áudio e vídeo. Use um navegador atualizado em HTTPS.',
      };
    }

    const needsScreen = settings.source === 'screen' || settings.source === 'both';
    const needsCamera = settings.source === 'camera' || settings.source === 'both';
    if (needsScreen && !navigator.mediaDevices.getDisplayMedia) {
      return {
        granted: false,
        screenCaptureGranted: false,
        cameraGranted: !needsCamera,
        microphoneGranted: !settings.microphone || !needsCamera,
        screenAudioAvailable: false,
        reason: 'Este navegador não suporta compartilhar a tela. Tente usar a câmera ou abrir o beta no Chrome, Edge ou Firefox.',
      };
    }
    if (needsCamera && !navigator.mediaDevices.getUserMedia) {
      return {
        granted: false,
        screenCaptureGranted: !needsScreen,
        cameraGranted: false,
        microphoneGranted: false,
        screenAudioAvailable: false,
        reason: 'Este navegador não oferece acesso à câmera ou ao microfone.',
      };
    }

    const streams: CaptureStreams = {};
    let requestedSource: CaptureTrackSource = needsScreen ? 'screen' : 'camera';
    try {
      // getDisplayMedia must be invoked directly from the user's click. Do not
      // insert an await before this call: browsers require transient activation.
      const screenRequest = needsScreen
        ? navigator.mediaDevices.getDisplayMedia(getDisplayMediaOptions(settings))
        : null;
      if (screenRequest) streams.screen = await screenRequest;
      if (needsCamera) {
        requestedSource = 'camera';
        streams.camera = await navigator.mediaDevices.getUserMedia(getCameraMediaOptions(settings));
      }

      if (generation !== captureRequestGeneration) {
        stopStreams(streams);
        return {
          granted: false,
          screenCaptureGranted: false,
          cameraGranted: false,
          microphoneGranted: false,
          screenAudioAvailable: false,
          reason: 'A solicitação de captura foi substituída por outra tentativa.',
        };
      }

      const hasScreen = !needsScreen || !!streams.screen?.getVideoTracks().length;
      const hasCamera = !needsCamera || !!streams.camera?.getVideoTracks().length;
      const needsMicrophone = needsCamera && settings.microphone;
      const hasMicrophone = !needsMicrophone || !!streams.camera?.getAudioTracks().length;
      if (!hasScreen || !hasCamera || !hasMicrophone) {
        stopStreams(streams);
        return {
          granted: false,
          screenCaptureGranted: hasScreen,
          cameraGranted: hasCamera,
          microphoneGranted: hasMicrophone,
          screenAudioAvailable: !!streams.screen?.getAudioTracks().length,
          reason: 'O navegador não liberou todas as faixas de mídia solicitadas. Confira as permissões e tente novamente.',
        };
      }

      pendingCapture = { settings, streams };
      return {
        granted: true,
        screenCaptureGranted: hasScreen,
        cameraGranted: hasCamera,
        microphoneGranted: hasMicrophone,
        screenAudioAvailable: !!streams.screen?.getAudioTracks().length,
        ...(needsScreen && settings.screenAudio && !streams.screen?.getAudioTracks().length
          ? { reason: 'A tela foi compartilhada sem áudio. O navegador ou a fonte escolhida não disponibilizou o áudio da tela.' }
          : {}),
      };
    } catch (error) {
      stopStreams(streams);
      if (generation !== captureRequestGeneration) {
        return {
          granted: false,
          screenCaptureGranted: false,
          cameraGranted: false,
          microphoneGranted: false,
          screenAudioAvailable: false,
          reason: 'A solicitação de captura foi substituída por outra tentativa.',
        };
      }
      return {
        granted: false,
        screenCaptureGranted: false,
        cameraGranted: false,
        microphoneGranted: false,
        screenAudioAvailable: false,
        reason: getCaptureErrorMessage(error, requestedSource),
      };
    }
  }

  async startBroadcast(settings: CaptureSettings, webOrigin: string): Promise<string> {
    const capture = pendingCapture;
    pendingCapture = null;
    this.stopSessionNow();
    captureRequestGeneration += 1;
    if (!capture || JSON.stringify(capture.settings) !== JSON.stringify(settings)) {
      stopStreams(capture?.streams ?? {});
      throw new Error('A captura expirou. Clique em transmitir e conceda as permissões novamente.');
    }

    const id = createSessionId();
    const session: BroadcastSession = {
      id,
      kind: 'broadcast',
      peer: new Peer(PEER_OPTIONS),
      streams: capture.streams,
      settings,
      calls: new Set(),
      chatConnections: new Set(),
      chatViewerIndex: 0,
    };
    this.activeSession = session;
    this.lastSessionId = id;
    this.emitState('starting', id);

    for (const source of ['screen', 'camera'] as const) {
      const stream = session.streams[source];
      if (!stream) continue;
      setWebVideoStream(id, source, stream, true);
      this.emitTrack(id, source, true, true);
      stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => this.handleCaptureEnded(session, source), { once: true }));
    }

    const screenAudioAvailable = !!session.streams.screen?.getAudioTracks().length;
    this.emit('screenAudioCapabilityChanged', {
      available: screenAudioAvailable,
      ...(settings.screenAudio && !screenAudioAvailable
        ? { reason: 'O navegador ou a tela escolhida não disponibilizou áudio da tela.' }
        : settings.screenAudio ? {} : { reason: 'O áudio da tela foi desativado nas configurações.' }),
      sessionId: id,
    });

    session.peer.on('open', (peerId) => {
      if (this.activeSession !== session) return;
      session.peerId = peerId;
      this.emit('shareUrlChanged', { url: buildWatchUrl(webOrigin, peerId), sessionId: id });
      this.emit('chatReadyChanged', { ready: true, sessionId: id });
      this.emitState('broadcasting', id);
    });
    session.peer.on('call', (call) => this.handleIncomingMediaCall(session, call));
    session.peer.on('connection', (connection) => this.handleIncomingChatConnection(session, connection));
    session.peer.on('error', (error) => {
      if (this.activeSession !== session) return;
      this.failSession(session, { code: 'peer-error', message: peerErrorMessage(error, 'broadcast') });
    });
    session.peer.on('disconnected', () => {
      if (this.activeSession !== session) return;
      this.emitState('broadcasting', id, {
        code: 'signaling-disconnected',
        message: 'A conexão com o servidor de sinalização foi perdida. A live atual pode continuar, mas novos espectadores talvez não consigam entrar.',
      });
    });
    return id;
  }

  async startViewer(options: StartViewerOptions): Promise<string> {
    const previousSession = this.activeSession;
    const reusableSessionId = previousSession?.id ?? this.retrySessionId;
    if (previousSession) {
      this.stopSessionNow(false);
    } else if (!reusableSessionId) {
      this.stopSessionNow();
    } else {
      const capture = pendingCapture;
      pendingCapture = null;
      stopStreams(capture?.streams ?? {});
    }
    const id = reusableSessionId ?? createSessionId();
    this.retrySessionId = null;
    captureRequestGeneration += 1;
    this.lastViewerOptions = options;
    this.lastViewerSessionId = id;
    const session: ViewerSession = {
      id,
      kind: 'viewer',
      options,
      peer: new Peer(PEER_OPTIONS),
      mediaCalls: {},
      negotiationStreams: [],
      remoteStreams: {},
      settledSources: new Set(),
      receivedSources: new Set(),
      chatConnections: new Set(),
      audioEnabled: false,
      volume: 1,
    };
    this.activeSession = session;
    this.lastSessionId = id;
    setWebViewerAudio(id, false, 1);
    this.emitState('connecting', id);
    this.emit('chatReadyChanged', { ready: false, sessionId: id });

    session.peer.on('open', () => {
      if (this.activeSession !== session) return;
      this.connectViewerMedia(session);
      this.connectViewerChat(session);
    });
    session.peer.on('error', (error) => {
      if (this.activeSession !== session) return;
      this.failSession(session, { code: 'peer-error', message: peerErrorMessage(error, 'viewer') });
    });
    session.peer.on('disconnected', () => {
      if (this.activeSession !== session) return;
      this.emitState('connecting', id, {
        code: 'signaling-disconnected',
        message: 'A conexão de sinalização foi perdida. Tente reconectar à transmissão.',
      });
    });
    session.timeout = setTimeout(() => {
      if (this.activeSession !== session) return;
      if (session.receivedSources.size === 0) {
        this.failSession(session, {
          code: 'connection-timeout',
          message: 'A transmissão não respondeu. Ela pode ter sido encerrada ou o transmissor pode estar offline.',
        });
        return;
      }
      for (const source of [...session.settledSources]) {
        session.mediaCalls[source]?.close();
        this.settleViewerSource(session, source, { type: 'peer-unavailable' });
      }
    }, VIEWER_CONNECTION_TIMEOUT_MS);
    return id;
  }

  async stopSession(): Promise<void> {
    captureRequestGeneration += 1;
    this.stopSessionNow();
    const capture = pendingCapture;
    pendingCapture = null;
    stopStreams(capture?.streams ?? {});
  }

  async retryViewer(): Promise<void> {
    if (!this.lastViewerOptions) throw new Error('Não há uma transmissão para tentar novamente.');
    if (!this.activeSession && this.lastViewerSessionId) this.retrySessionId = this.lastViewerSessionId;
    await this.startViewer(this.lastViewerOptions);
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    const session = this.activeSession;
    if (!session || session.kind !== 'broadcast') throw new Error('Não há uma transmissão ativa.');
    session.streams.camera?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
  }

  async setViewerAudio(enabled: boolean, volume: number): Promise<void> {
    const session = this.activeSession;
    if (!session || session.kind !== 'viewer') return;
    session.audioEnabled = enabled;
    session.volume = Math.max(0, Math.min(1, volume));
    setWebViewerAudio(session.id, session.audioEnabled, session.volume);
  }

  async flipCamera(): Promise<void> {
    const session = this.activeSession;
    if (!session || session.kind !== 'broadcast' || !session.streams.camera) return;
    const nextFacing = session.settings.cameraFacing === 'user' ? 'environment' : 'user';
    let replacement: MediaStream | null = null;
    try {
      replacement = await navigator.mediaDevices.getUserMedia({
        video: { ...getVideoConstraints(session.settings), facingMode: { ideal: nextFacing } },
        audio: false,
      });
      if (this.activeSession !== session) {
        stopStream(replacement);
        return;
      }
      const nextTrack = replacement.getVideoTracks()[0];
      if (!nextTrack) throw new Error('O navegador não encontrou uma faixa de vídeo para a câmera.');
      const oldStream = session.streams.camera;
      const oldTrack = oldStream.getVideoTracks()[0];
      nextTrack.addEventListener('ended', () => this.handleCaptureEnded(session, 'camera'), { once: true });
      const senderChanges: Promise<void>[] = [];
      [...session.calls].filter((entry) => entry.source === 'camera').forEach(({ call }) => {
        const sender = call.peerConnection.getSenders().find((activeSender) => activeSender.track?.kind === 'video');
        if (sender) senderChanges.push(sender.replaceTrack(nextTrack));
      });
      await Promise.all(senderChanges);
      if (oldTrack) oldStream.removeTrack(oldTrack);
      oldStream.addTrack(nextTrack);
      if (oldTrack) oldTrack.stop();
      session.streams.camera = oldStream;
      session.settings = { ...session.settings, cameraFacing: nextFacing };
      setWebVideoStream(session.id, 'camera', oldStream, true);
      replacement = null;
    } catch (error) {
      stopStream(replacement);
      if (this.activeSession === session) {
        this.emitState('broadcasting', session.id, {
          code: 'camera-switch-failed',
          message: error instanceof Error ? error.message : 'Não foi possível inverter a câmera.',
        });
      }
    }
  }

  async sendChatMessage(text: string, name?: string): Promise<void> {
    const session = this.activeSession;
    const cleanText = sanitizeChatText(text);
    if (!session || !cleanText) return;

    if (session.kind === 'viewer') {
      const connection = [...session.chatConnections].find((activeConnection) => activeConnection.open);
      if (!connection) return;
      const authorName = sanitizeChatName(name ?? '');
      connection.send({ text: cleanText, name: authorName || undefined });
      const message = buildChatMessage({ text: cleanText, authorName: authorName || 'Você', isBroadcaster: false });
      this.emitChatMessage(session.id, message, true);
      return;
    }

    const message = buildChatMessage({ text: cleanText, authorName: 'Transmissor', isBroadcaster: true });
    session.chatConnections.forEach((connection) => {
      if (connection.open) connection.send(message);
    });
    this.emitChatMessage(session.id, message, true);
  }

  async enterPictureInPicture(): Promise<boolean> {
    const session = this.activeSession;
    if (!session || session.kind !== 'viewer') return false;
    const video = getWebVideoElement(session.id, 'screen') ?? getWebVideoElement(session.id, 'camera');
    if (!video) return false;

    try {
      const documentWithPip = document as Document & {
        pictureInPictureEnabled?: boolean;
        pictureInPictureElement?: Element | null;
        exitPictureInPicture?: () => Promise<void>;
      };
      const videoWithPip = video as WebkitVideoElement & {
        requestPictureInPicture?: () => Promise<PictureInPictureWindow>;
      };
      if (documentWithPip.pictureInPictureEnabled && videoWithPip.requestPictureInPicture) {
        if (documentWithPip.pictureInPictureElement === video && documentWithPip.exitPictureInPicture) {
          await documentWithPip.exitPictureInPicture();
        } else {
          await videoWithPip.requestPictureInPicture();
        }
        return true;
      }
      if (videoWithPip.webkitSetPresentationMode) {
        const isInPip = videoWithPip.webkitPresentationMode === 'picture-in-picture';
        videoWithPip.webkitSetPresentationMode(isInPip ? 'inline' : 'picture-in-picture');
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private stopSessionNow(emitIdle = true) {
    const session = this.activeSession;
    if (!session) {
      if (emitIdle && this.lastSessionId) {
        this.emitState('idle', this.lastSessionId);
        this.lastSessionId = null;
        this.lastViewerSessionId = null;
        this.lastViewerOptions = null;
        this.retrySessionId = null;
      }
      return;
    }
    this.activeSession = null;
    if (session.timeout) clearTimeout(session.timeout);

    session.chatConnections.forEach((connection) => connection.close());
    session.chatConnections.clear();
    if (session.kind === 'broadcast') {
      session.calls.forEach(({ call }) => call.close());
      session.calls.clear();
      for (const source of ['screen', 'camera'] as const) this.emitTrack(session.id, source, false, true);
      stopStreams(session.streams);
    } else {
      Object.values(session.mediaCalls).forEach((call) => call?.close());
      for (const source of ['screen', 'camera'] as const) this.emitTrack(session.id, source, false, false);
      session.negotiationStreams.forEach(stopStream);
      stopStreams(session.remoteStreams);
    }
    session.peer.destroy();
    clearWebVideoSession(session.id);
    this.emit('viewerCountChanged', { count: 0, sessionId: session.id });
    this.emit('chatReadyChanged', { ready: false, sessionId: session.id });
    if (emitIdle) {
      this.emitState('idle', session.id);
      this.lastSessionId = null;
      this.lastViewerSessionId = null;
      this.lastViewerOptions = null;
      this.retrySessionId = null;
    }
    emitPictureInPictureChange(false);
  }

  private failSession(session: ActiveSession, error: { code: string; message: string }) {
    if (this.activeSession !== session) return;
    this.activeSession = null;
    if (session.timeout) clearTimeout(session.timeout);
    session.chatConnections.forEach((connection) => connection.close());
    session.chatConnections.clear();
    if (session.kind === 'broadcast') {
      session.calls.forEach(({ call }) => call.close());
      session.calls.clear();
      for (const source of ['screen', 'camera'] as const) this.emitTrack(session.id, source, false, true);
      stopStreams(session.streams);
    } else {
      Object.values(session.mediaCalls).forEach((call) => call?.close());
      for (const source of ['screen', 'camera'] as const) this.emitTrack(session.id, source, false, false);
      session.negotiationStreams.forEach(stopStream);
      stopStreams(session.remoteStreams);
    }
    session.peer.destroy();
    clearWebVideoSession(session.id);
    this.emit('viewerCountChanged', { count: 0, sessionId: session.id });
    this.emit('chatReadyChanged', { ready: false, sessionId: session.id });
    this.emitState('error', session.id, error);
    emitPictureInPictureChange(false);
  }

  private emitState(
    mode: 'idle' | 'starting' | 'broadcasting' | 'connecting' | 'watching' | 'error',
    sessionId: string,
    error?: { code: string; message: string },
  ) {
    this.emit('stateChanged', { mode, sessionId, ...(error ? { error } : {}) });
  }

  private emitTrack(sessionId: string, source: CaptureTrackSource, available: boolean, local: boolean) {
    this.emit('trackChanged', { source, available, local, sessionId });
  }

  private emitChatMessage(sessionId: string, message: ChatMessage, isSelf: boolean) {
    this.emit('chatMessage', { ...message, sessionId, isSelf });
  }

  private handleCaptureEnded(session: BroadcastSession, source: CaptureTrackSource) {
    if (this.activeSession !== session || !session.streams[source]) return;
    const stream = session.streams[source];
    session.streams[source] = undefined;
    stream?.getTracks().forEach((track) => {
      if (track.readyState !== 'ended') track.stop();
    });
    setWebVideoStream(session.id, source, null, true);
    this.emitTrack(session.id, source, false, true);
    [...session.calls].filter((entry) => entry.source === source).forEach(({ call }) => call.close());
    const hasAnySource = !!session.streams.screen || !!session.streams.camera;
    if (!hasAnySource) {
      this.failSession(session, {
        code: 'capture-ended',
        message: 'A captura foi encerrada pelo navegador. Inicie uma nova transmissão para continuar.',
      });
    }
  }

  private handleIncomingMediaCall(session: BroadcastSession, call: MediaConnection) {
    if (this.activeSession !== session) {
      call.close();
      return;
    }
    const metadata = call.metadata as { role?: unknown; source?: unknown } | undefined;
    if (metadata?.role !== 'viewer') {
      call.close();
      return;
    }
    const source: CaptureTrackSource = metadata.source === 'camera' ? 'camera' : 'screen';
    const stream = session.streams[source];
    if (!stream) {
      call.close();
      return;
    }

    const viewerId = getMediaIdentity(call.peer, call.metadata);
    const viewerSessionId = getViewerSessionIdentity(call.peer, call.metadata);
    const existing = [...session.calls].filter((entry) => entry.viewerId === viewerId);
    const anotherSessionActive = existing.some((entry) => entry.viewerSessionId !== viewerSessionId);
    if (anotherSessionActive || existing.length >= MAX_MEDIA_CONNECTIONS_PER_SESSION) {
      call.close();
      try {
        (session.peer as unknown as { socket?: { send(message: { type: 'LEAVE'; dst: string }): void } })
          .socket?.send({ type: 'LEAVE', dst: call.peer });
      } catch {
        // PeerJS closes the rejected media connection even if signaling is unavailable.
      }
      return;
    }

    const entry: BroadcastCall = { call, source, viewerId, viewerSessionId };
    session.calls.add(entry);
    this.emit('viewerCountChanged', {
      count: new Set([...session.calls].map((activeCall) => activeCall.viewerId)).size,
      sessionId: session.id,
    });
    const removeCall = () => {
      if (!session.calls.delete(entry)) return;
      this.emit('viewerCountChanged', {
        count: new Set([...session.calls].map((activeCall) => activeCall.viewerId)).size,
        sessionId: session.id,
      });
    };
    call.on('close', removeCall);
    call.on('error', removeCall);
    try {
      call.answer(stream);
      if (session.settings.bitrate) {
        const videoSender = call.peerConnection.getSenders().find((sender) => sender.track?.kind === 'video');
        if (videoSender) {
          const parameters = videoSender.getParameters();
          parameters.encodings = (parameters.encodings?.length ? parameters.encodings : [{}]).map((encoding) => ({
            ...encoding,
            maxBitrate: session.settings.bitrate ?? undefined,
          }));
          void videoSender.setParameters(parameters).catch(() => undefined);
        }
      }
    } catch {
      call.close();
      removeCall();
    }
  }

  private handleIncomingChatConnection(session: BroadcastSession, connection: DataConnection) {
    if (this.activeSession !== session || connection.metadata?.role !== CHAT_CONNECTION_ROLE) {
      connection.close();
      return;
    }
    session.chatViewerIndex += 1;
    const viewerIndex = session.chatViewerIndex;
    session.chatConnections.add(connection);
    connection.on('data', (rawData) => {
      if (this.activeSession !== session) return;
      const draft = parseData(rawData);
      if (!draft || typeof draft.text !== 'string') return;
      const text = sanitizeChatText(draft.text);
      if (!text) return;
      const name = typeof draft.name === 'string'
        ? draft.name
        : typeof draft.authorName === 'string' ? draft.authorName : undefined;
      const message = buildChatMessage({
        text,
        authorName: resolveAuthorName(name, viewerIndex),
        isBroadcaster: false,
      });
      this.emitChatMessage(session.id, message, false);
      session.chatConnections.forEach((activeConnection) => {
        if (activeConnection !== connection && activeConnection.open) activeConnection.send(message);
      });
    });
    const remove = () => session.chatConnections.delete(connection);
    connection.on('close', remove);
    connection.on('error', remove);
  }

  private connectViewerMedia(session: ViewerSession) {
    try {
      const sources = getCaptureTracks('both');
      sources.forEach((source) => session.settledSources.add(source));
      for (const source of sources) {
        const negotiation = createNegotiationStream();
        session.negotiationStreams.push(negotiation.stream);
        const call = session.peer.call(session.options.broadcastId, negotiation.stream, {
          metadata: {
            role: 'viewer',
            source,
            viewerId: session.options.viewerId,
            viewerSessionId: session.options.viewerSessionId,
          },
        });
        if (!call) {
          this.settleViewerSource(session, source);
          continue;
        }
        session.mediaCalls[source] = call;
        call.on('stream', (stream) => {
          if (this.activeSession !== session) return;
          session.settledSources.delete(source);
          session.receivedSources.add(source);
          session.remoteStreams[source] = stream;
          setWebVideoStream(session.id, source, stream, false);
          this.emitTrack(session.id, source, true, false);
          this.emitState('watching', session.id);
          if (session.settledSources.size === 0 && session.timeout) {
            clearTimeout(session.timeout);
            session.timeout = undefined;
          }
          stream.getTracks().forEach((track) => track.addEventListener('ended', () => {
            if (this.activeSession !== session || session.remoteStreams[source] !== stream) return;
            session.remoteStreams[source] = undefined;
            session.receivedSources.delete(source);
            setWebVideoStream(session.id, source, null, false);
            this.emitTrack(session.id, source, false, false);
            this.maybeFailViewer(session, { type: 'peer-unavailable' });
          }, { once: true }));
        });
        call.on('close', () => this.settleViewerSource(session, source));
        call.on('error', (error) => this.settleViewerSource(session, source, error));
      }
    } catch (error) {
      this.failSession(session, { code: 'media-connection-failed', message: peerErrorMessage(error, 'viewer') });
    }
  }

  private settleViewerSource(session: ViewerSession, source: CaptureTrackSource, error?: unknown) {
    if (this.activeSession !== session) return;
    session.settledSources.delete(source);
    const currentCall = session.mediaCalls[source];
    if (currentCall) delete session.mediaCalls[source];
    if (session.remoteStreams[source]) {
      stopStream(session.remoteStreams[source]);
      session.remoteStreams[source] = undefined;
      session.receivedSources.delete(source);
      setWebVideoStream(session.id, source, null, false);
      this.emitTrack(session.id, source, false, false);
    }
    if (session.receivedSources.size === 0 && session.settledSources.size === 0) {
      this.maybeFailViewer(session, error);
    }
  }

  private maybeFailViewer(session: ViewerSession, error?: unknown) {
    if (this.activeSession !== session || session.receivedSources.size > 0 || session.settledSources.size > 0) return;
    if (session.timeout) {
      clearTimeout(session.timeout);
      session.timeout = undefined;
    }
    this.failSession(session, { code: 'peer-unavailable', message: peerErrorMessage(error ?? { type: 'peer-unavailable' }, 'viewer') });
  }

  private connectViewerChat(session: ViewerSession) {
    try {
      const connection = session.peer.connect(session.options.broadcastId, {
        metadata: {
          role: CHAT_CONNECTION_ROLE,
          viewerId: session.options.viewerId,
          viewerSessionId: session.options.viewerSessionId,
        },
      });
      session.chatConnections.add(connection);
      connection.on('open', () => {
        if (this.activeSession === session) this.emit('chatReadyChanged', { ready: true, sessionId: session.id });
      });
      connection.on('data', (rawData) => {
        if (this.activeSession !== session) return;
        const draft = parseData(rawData);
        if (!draft || typeof draft.text !== 'string' || typeof draft.authorName !== 'string') return;
        const message = buildChatMessage({
          text: draft.text,
          authorName: draft.authorName,
          isBroadcaster: draft.isBroadcaster === true,
        });
        if (typeof draft.id === 'string') message.id = draft.id;
        if (typeof draft.timestamp === 'number') message.timestamp = draft.timestamp;
        this.emitChatMessage(session.id, message, false);
      });
      const closed = () => {
        session.chatConnections.delete(connection);
        if (this.activeSession === session) this.emit('chatReadyChanged', { ready: false, sessionId: session.id });
      };
      connection.on('close', closed);
      connection.on('error', closed);
    } catch {
      this.emit('chatReadyChanged', { ready: false, sessionId: session.id });
    }
  }
}

export const P2PCastMedia = registerWebModule(P2PCastMediaModule, 'P2PCastMedia') as unknown as InstanceType<typeof P2PCastMediaModule>;
subscribeToPictureInPicture((isInPictureInPictureMode) => P2PCastMedia.emit('pipModeChanged', { isInPictureInPictureMode }));

export default P2PCastMedia;
