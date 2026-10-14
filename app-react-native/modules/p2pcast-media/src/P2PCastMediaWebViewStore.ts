import type { CaptureTrackSource } from '@/domain/capture';

type StreamEntry = { stream: MediaStream; isLocal: boolean };
export type WebVideoSnapshot = {
  stream: MediaStream | null;
  isLocal: boolean;
  audioEnabled: boolean;
  volume: number;
};

type ViewListener = (sessionId: string, source: CaptureTrackSource) => void;

const streams = new Map<string, Partial<Record<CaptureTrackSource, StreamEntry>>>();
const audioStates = new Map<string, { enabled: boolean; volume: number }>();
const videoElements = new Map<string, Partial<Record<CaptureTrackSource, HTMLVideoElement>>>();
const viewListeners = new Set<ViewListener>();
const pictureInPictureListeners = new Set<(isInPictureInPictureMode: boolean) => void>();

function notifyView(sessionId: string, source: CaptureTrackSource) {
  viewListeners.forEach((listener) => listener(sessionId, source));
}

export function setWebVideoStream(
  sessionId: string,
  source: CaptureTrackSource,
  stream: MediaStream | null,
  isLocal: boolean,
) {
  const sessionStreams = streams.get(sessionId) ?? {};
  if (stream) {
    sessionStreams[source] = { stream, isLocal };
    streams.set(sessionId, sessionStreams);
  } else {
    delete sessionStreams[source];
    if (!sessionStreams.screen && !sessionStreams.camera) streams.delete(sessionId);
  }
  notifyView(sessionId, source);
}

export function setWebViewerAudio(sessionId: string, enabled: boolean, volume: number) {
  audioStates.set(sessionId, { enabled, volume: Math.max(0, Math.min(1, volume)) });
  for (const source of ['screen', 'camera'] as const) notifyView(sessionId, source);
}

export function getWebVideoSnapshot(sessionId: string, source: CaptureTrackSource): WebVideoSnapshot {
  const entry = streams.get(sessionId)?.[source];
  const audio = audioStates.get(sessionId);
  return {
    stream: entry?.stream ?? null,
    isLocal: entry?.isLocal ?? false,
    audioEnabled: audio?.enabled ?? false,
    volume: audio?.volume ?? 1,
  };
}

export function subscribeToWebVideo(
  sessionId: string,
  source: CaptureTrackSource,
  listener: () => void,
) {
  const wrappedListener: ViewListener = (changedSessionId, changedSource) => {
    if (changedSessionId === sessionId && changedSource === source) listener();
  };
  viewListeners.add(wrappedListener);
  return () => {
    viewListeners.delete(wrappedListener);
  };
}

export function registerWebVideoElement(
  sessionId: string,
  source: CaptureTrackSource,
  element: HTMLVideoElement | null,
) {
  const elements = videoElements.get(sessionId) ?? {};
  if (element) {
    elements[source] = element;
    videoElements.set(sessionId, elements);
  } else {
    delete elements[source];
    if (!elements.screen && !elements.camera) videoElements.delete(sessionId);
  }
}

export function getWebVideoElement(sessionId: string, source: CaptureTrackSource) {
  return videoElements.get(sessionId)?.[source] ?? null;
}

export function clearWebVideoSession(sessionId: string) {
  const sessionStreams = streams.get(sessionId);
  streams.delete(sessionId);
  audioStates.delete(sessionId);
  for (const source of ['screen', 'camera'] as const) {
    const entry = sessionStreams?.[source];
    if (entry) notifyView(sessionId, source);
  }
}

export function subscribeToPictureInPicture(listener: (isInPictureInPictureMode: boolean) => void) {
  pictureInPictureListeners.add(listener);
  return () => {
    pictureInPictureListeners.delete(listener);
  };
}

export function emitPictureInPictureChange(isInPictureInPictureMode: boolean) {
  pictureInPictureListeners.forEach((listener) => listener(isInPictureInPictureMode));
}
