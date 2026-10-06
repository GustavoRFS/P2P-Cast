import { useCallback, useState } from 'react';

import { DEFAULT_WEB_ORIGIN } from '@/domain/room';
import type { CaptureSettings } from '@/domain/capture';
import { P2PCastMedia } from '../../modules/p2pcast-media';
import { useMediaSession } from './MediaSessionProvider';

export function useBroadcastSession() {
  const session = useMediaSession();
  const [microphoneMuted, setMicrophoneMutedState] = useState(false);

  const start = useCallback(async (settings: CaptureSettings) => {
    const permissions = await P2PCastMedia.requestCapturePermissions(settings);
    if (!permissions.granted) throw new Error(permissions.reason ?? 'As permissões necessárias não foram concedidas.');
    await P2PCastMedia.startBroadcast(settings, DEFAULT_WEB_ORIGIN);
    setMicrophoneMutedState(false);
  }, []);

  const stop = useCallback(async () => {
    await P2PCastMedia.stopSession();
    setMicrophoneMutedState(false);
  }, []);

  const setMicrophoneMuted = useCallback(async (muted: boolean) => {
    await P2PCastMedia.setMicrophoneMuted(muted);
    setMicrophoneMutedState(muted);
  }, []);

  const flipCamera = useCallback(() => P2PCastMedia.flipCamera(), []);
  const sendChatMessage = useCallback((text: string) => P2PCastMedia.sendChatMessage(text), []);

  return {
    ...session,
    microphoneMuted,
    start,
    stop,
    setMicrophoneMuted,
    flipCamera,
    sendChatMessage,
  };
}
