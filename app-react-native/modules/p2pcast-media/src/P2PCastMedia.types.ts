import type { StyleProp, ViewStyle } from 'react-native';
import type { CaptureSettings, CaptureTrackSource } from '@/domain/capture';
import type { ChatMessage } from '@/domain/chat';

export type NativeSessionMode = 'idle' | 'starting' | 'broadcasting' | 'connecting' | 'watching' | 'error';

export type NativeError = {
  code: string;
  message: string;
};

export type NativeMediaEventMap = {
  stateChanged: { mode: NativeSessionMode; sessionId?: string; error?: NativeError };
  shareUrlChanged: { url: string; sessionId: string };
  viewerCountChanged: { count: number; sessionId: string };
  trackChanged: { source: CaptureTrackSource; available: boolean; local: boolean; sessionId: string };
  chatMessage: ChatMessage & { sessionId: string; isSelf: boolean };
  chatReadyChanged: { ready: boolean; sessionId: string };
  screenAudioCapabilityChanged: { available: boolean; reason?: string; sessionId?: string };
  pipModeChanged: { isInPictureInPictureMode: boolean };
};

export type NativeMediaEventName = keyof NativeMediaEventMap;

export type P2PCastMediaModuleEvents = {
  [K in NativeMediaEventName]: (payload: NativeMediaEventMap[K]) => void;
};

export type CapturePermissionResult = {
  granted: boolean;
  screenCaptureGranted: boolean;
  cameraGranted: boolean;
  microphoneGranted: boolean;
  screenAudioAvailable: boolean;
  reason?: string;
};

export type StartViewerOptions = {
  broadcastId: string;
  viewerId: string;
  viewerSessionId: string;
};

export type VideoScaleMode = 'contain' | 'cover';

export type P2PCastVideoViewProps = {
  sessionId: string;
  source: CaptureTrackSource;
  scaleMode?: VideoScaleMode;
  mirror?: boolean;
  style?: StyleProp<ViewStyle>;
};

export type P2PCastMediaApi = {
  requestCapturePermissions(settings: CaptureSettings): Promise<CapturePermissionResult>;
  startBroadcast(settings: CaptureSettings, webOrigin: string): Promise<string>;
  startViewer(options: StartViewerOptions): Promise<string>;
  stopSession(): Promise<void>;
  retryViewer(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;
  setViewerAudio(enabled: boolean, volume: number): Promise<void>;
  flipCamera(): Promise<void>;
  sendChatMessage(text: string, name?: string): Promise<void>;
  enterPictureInPicture(): Promise<boolean>;
};
