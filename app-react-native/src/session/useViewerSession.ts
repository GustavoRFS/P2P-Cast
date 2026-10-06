import { useCallback, useEffect, useRef, useState } from 'react';

import { createViewerSessionId } from '@/domain/room';
import { loadChatSoundEnabled, loadOrCreateViewerId, loadViewerName, loadViewerVolume, saveChatSoundEnabled, saveViewerName, saveViewerVolume } from '@/storage/preferences';
import { sanitizeChatName, sanitizeChatText } from '@/domain/chat';
import { P2PCastMedia } from '../../modules/p2pcast-media';
import { useMediaSession } from './MediaSessionProvider';

export function useViewerSession(broadcastId: string) {
  const session = useMediaSession();
  const [viewerName, setViewerName] = useState('');
  const [audioEnabled, setAudioEnabledState] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [chatSoundEnabled, setChatSoundEnabled] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const viewerRef = useRef<{ viewerId: string; viewerSessionId: string } | null>(null);
  const connectionGeneration = useRef(0);

  const connect = useCallback(async (expectedGeneration?: number) => {
    const cleanId = broadcastId.trim();
    if (!cleanId) {
      setConnectionError('O código da transmissão está vazio.');
      return;
    }
    const generation = expectedGeneration ?? ++connectionGeneration.current;
    setConnectionError(null);
    try {
      const [viewerId, nativeName, savedVolume, soundEnabled] = await Promise.all([
        loadOrCreateViewerId(),
        loadViewerName(),
        loadViewerVolume(),
        loadChatSoundEnabled(),
      ]);
      if (connectionGeneration.current !== generation) return;
      const viewerSessionId = createViewerSessionId();
      setViewerName(nativeName);
      setVolumeState(savedVolume);
      setChatSoundEnabled(soundEnabled);
      await P2PCastMedia.startViewer({ broadcastId: cleanId, viewerId, viewerSessionId });
      if (connectionGeneration.current !== generation) {
        await P2PCastMedia.stopSession();
        return;
      }
      viewerRef.current = { viewerId, viewerSessionId };
      await P2PCastMedia.setViewerAudio(false, savedVolume);
    } catch (error) {
      if (connectionGeneration.current !== generation) return;
      setConnectionError(error instanceof Error ? error.message : 'Não foi possível abrir a transmissão.');
    }
  }, [broadcastId]);

  useEffect(() => {
    const generation = ++connectionGeneration.current;
    void connect(generation);
    return () => {
      connectionGeneration.current += 1;
      void P2PCastMedia.stopSession();
    };
  }, [connect]);

  const retry = useCallback(async () => {
    setConnectionError(null);
    try {
      if (!viewerRef.current) return connect();
      await P2PCastMedia.retryViewer();
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Não foi possível tentar novamente.');
    }
  }, [connect]);

  const leave = useCallback(async () => {
    await P2PCastMedia.stopSession();
  }, []);

  const setAudioEnabled = useCallback(async (enabled: boolean) => {
    setAudioEnabledState(enabled);
    if (session.sessionId) await P2PCastMedia.setViewerAudio(enabled, volume);
  }, [session.sessionId, volume]);

  const setVolume = useCallback(async (next: number) => {
    const safeVolume = Math.max(0, Math.min(1, next));
    setVolumeState(safeVolume);
    await saveViewerVolume(safeVolume);
    if (session.sessionId) await P2PCastMedia.setViewerAudio(audioEnabled, safeVolume);
  }, [audioEnabled, session.sessionId]);

  const setName = useCallback((value: string) => {
    const safeName = sanitizeChatName(value);
    setViewerName(safeName);
    void saveViewerName(safeName);
  }, []);

  const setChatSound = useCallback((enabled: boolean) => {
    setChatSoundEnabled(enabled);
    void saveChatSoundEnabled(enabled);
  }, []);

  const sendChatMessage = useCallback((text: string) => {
    const cleanText = sanitizeChatText(text);
    if (!cleanText) return Promise.resolve();
    return P2PCastMedia.sendChatMessage(cleanText, viewerName || undefined);
  }, [viewerName]);

  const enterPictureInPicture = useCallback(() => P2PCastMedia.enterPictureInPicture(), []);

  return {
    ...session,
    audioEnabled,
    volume,
    viewerName,
    chatSoundEnabled,
    connectionError,
    setName,
    setChatSound,
    setVolume,
    setAudioEnabled,
    sendChatMessage,
    retry,
    leave,
    enterPictureInPicture,
  };
}
