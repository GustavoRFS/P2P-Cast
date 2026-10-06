import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { P2PCastMedia, type NativeError, type NativeMediaEventMap, type NativeMediaEventName, type NativeSessionMode } from '../../modules/p2pcast-media';
import type { ChatMessage } from '@/domain/chat';

export type SessionChatMessage = ChatMessage & { sessionId: string; isSelf: boolean };

export type MediaSessionState = {
  sessionId: string | null;
  mode: NativeSessionMode;
  error: NativeError | null;
  shareUrl: string | null;
  viewerCount: number;
  tracks: { screen: boolean; camera: boolean };
  trackLocal: { screen: boolean; camera: boolean };
  chatMessages: SessionChatMessage[];
  chatReady: boolean;
  screenAudioAvailable: boolean;
  screenAudioReason: string | null;
  isInPictureInPictureMode: boolean;
};

const INITIAL_STATE: MediaSessionState = {
  sessionId: null,
  mode: 'idle',
  error: null,
  shareUrl: null,
  viewerCount: 0,
  tracks: { screen: false, camera: false },
  trackLocal: { screen: false, camera: false },
  chatMessages: [],
  chatReady: false,
  screenAudioAvailable: false,
  screenAudioReason: null,
  isInPictureInPictureMode: false,
};

type SessionContextValue = MediaSessionState & {
  setViewerAudioState: (enabled: boolean, volume: number) => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function MediaSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MediaSessionState>(INITIAL_STATE);
  const closedSessionIds = useRef(new Set<string>());
  const currentState = useRef(state);
  currentState.current = state;

  useEffect(() => {
    const currentEventMatches = (sessionId?: string) => {
      if (!sessionId) return true;
      if (closedSessionIds.current.has(sessionId)) return false;
      return currentState.current.sessionId === null || currentState.current.sessionId === sessionId;
    };

    const listeners: { remove: () => void }[] = [];
    const subscribe = <EventName extends NativeMediaEventName,>(eventName: EventName, listener: (event: NativeMediaEventMap[EventName]) => void) => {
      listeners.push(P2PCastMedia.addListener(eventName, listener));
    };

    subscribe('stateChanged', (event) => {
      if (event.mode === 'idle') {
        if (event.sessionId) closedSessionIds.current.add(event.sessionId);
        setState((current) => current.sessionId && event.sessionId && current.sessionId !== event.sessionId ? current : INITIAL_STATE);
        return;
      }
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({
        ...current,
        sessionId: event.sessionId ?? current.sessionId,
        mode: event.mode,
        error: event.error ?? (event.mode === 'error' ? current.error : null),
      }));
    });

    subscribe('shareUrlChanged', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({ ...current, sessionId: current.sessionId ?? event.sessionId, shareUrl: event.url }));
    });
    subscribe('viewerCountChanged', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({ ...current, sessionId: current.sessionId ?? event.sessionId, viewerCount: event.count }));
    });
    subscribe('trackChanged', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({
        ...current,
        sessionId: current.sessionId ?? event.sessionId,
        tracks: { ...current.tracks, [event.source]: event.available },
        trackLocal: { ...current.trackLocal, [event.source]: event.local },
      }));
    });
    subscribe('chatMessage', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => current.chatMessages.some((message) => message.id === event.id)
        ? current
        : { ...current, sessionId: current.sessionId ?? event.sessionId, chatMessages: [...current.chatMessages, event] });
    });
    subscribe('chatReadyChanged', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({ ...current, sessionId: current.sessionId ?? event.sessionId, chatReady: event.ready }));
    });
    subscribe('screenAudioCapabilityChanged', (event) => {
      if (!currentEventMatches(event.sessionId)) return;
      setState((current) => ({
        ...current,
        sessionId: current.sessionId ?? event.sessionId ?? null,
        screenAudioAvailable: event.available,
        screenAudioReason: event.reason ?? null,
      }));
    });
    subscribe('pipModeChanged', (event) => setState((current) => ({ ...current, isInPictureInPictureMode: event.isInPictureInPictureMode })));

    return () => listeners.forEach((listener) => listener.remove());
  }, []);

  const value = useMemo<SessionContextValue>(() => ({
    ...state,
    setViewerAudioState: (enabled, volume) => P2PCastMedia.setViewerAudio(enabled, volume),
  }), [state]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useMediaSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useMediaSession deve ser usado dentro de MediaSessionProvider.');
  return value;
}
