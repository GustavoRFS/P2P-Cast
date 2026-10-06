import { NativeModule, requireNativeModule } from 'expo';

import type { CaptureSettings } from '@/domain/capture';
import type {
  CapturePermissionResult,
  P2PCastMediaApi,
  P2PCastMediaModuleEvents,
  StartViewerOptions,
} from './P2PCastMedia.types';

declare class P2PCastMediaNativeModule extends NativeModule<P2PCastMediaModuleEvents> implements P2PCastMediaApi {
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
}

const nativeModule = requireNativeModule<P2PCastMediaNativeModule>('P2PCastMedia');

export const P2PCastMedia = nativeModule;
export default P2PCastMedia;
