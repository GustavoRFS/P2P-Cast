import { registerWebModule, NativeModule } from 'expo';

import type { CapturePermissionResult, P2PCastMediaApi, P2PCastMediaModuleEvents, StartViewerOptions } from './P2PCastMedia.types';

const WEB_BETA_MESSAGE = 'A transmissão de mídia ainda está disponível somente no app Android.';
const unavailable = () => new Error(WEB_BETA_MESSAGE);

class P2PCastMediaModule extends NativeModule<P2PCastMediaModuleEvents> implements P2PCastMediaApi {
  async requestCapturePermissions(): Promise<CapturePermissionResult> {
    return {
      granted: false,
      screenCaptureGranted: false,
      cameraGranted: false,
      microphoneGranted: false,
      screenAudioAvailable: false,
      reason: WEB_BETA_MESSAGE,
    };
  }

  async startBroadcast(): Promise<string> {
    throw unavailable();
  }

  async startViewer(_options: StartViewerOptions): Promise<string> {
    throw unavailable();
  }

  async stopSession(): Promise<void> {}

  async retryViewer(): Promise<void> {
    throw unavailable();
  }

  async setMicrophoneMuted(): Promise<void> {}

  async setViewerAudio(): Promise<void> {}

  async flipCamera(): Promise<void> {
    throw unavailable();
  }

  async sendChatMessage(): Promise<void> {
    throw unavailable();
  }

  async enterPictureInPicture(): Promise<boolean> {
    return false;
  }
}

export const P2PCastMedia = registerWebModule(P2PCastMediaModule, 'P2PCastMediaModule');
export default P2PCastMedia;
