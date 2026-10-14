import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import type { CSSProperties } from 'react';

import type { P2PCastVideoViewProps } from './P2PCastMedia.types';
import {
  emitPictureInPictureChange,
  getWebVideoSnapshot,
  registerWebVideoElement,
  subscribeToWebVideo,
  type WebVideoSnapshot,
} from './P2PCastMediaWebViewStore';

export default function P2PCastVideoView({ sessionId, source, scaleMode = 'contain', mirror = false, style }: P2PCastVideoViewProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [snapshot, setSnapshot] = useState<WebVideoSnapshot>(() => getWebVideoSnapshot(sessionId, source));

  useEffect(() => {
    setSnapshot(getWebVideoSnapshot(sessionId, source));
    return subscribeToWebVideo(sessionId, source, () => setSnapshot(getWebVideoSnapshot(sessionId, source)));
  }, [sessionId, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    registerWebVideoElement(sessionId, source, video);
    const emitPipState = () => {
      const isInPictureInPictureMode = document.pictureInPictureElement === video
        || (video as HTMLVideoElement & { webkitPresentationMode?: string }).webkitPresentationMode === 'picture-in-picture';
      emitPictureInPictureChange(isInPictureInPictureMode);
    };
    video.addEventListener('enterpictureinpicture', emitPipState);
    video.addEventListener('leavepictureinpicture', emitPipState);
    video.addEventListener('webkitpresentationmodechanged', emitPipState);
    return () => {
      video.removeEventListener('enterpictureinpicture', emitPipState);
      video.removeEventListener('leavepictureinpicture', emitPipState);
      video.removeEventListener('webkitpresentationmodechanged', emitPipState);
      video.srcObject = null;
      registerWebVideoElement(sessionId, source, null);
    };
  }, [sessionId, source]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== snapshot.stream) video.srcObject = snapshot.stream;
    video.muted = snapshot.isLocal || !snapshot.audioEnabled;
    video.volume = snapshot.volume;
    if (snapshot.stream) void video.play().catch(() => undefined);
  }, [snapshot.stream, snapshot.isLocal, snapshot.audioEnabled, snapshot.volume]);

  const videoStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'block',
    backgroundColor: '#030a12',
    objectFit: scaleMode,
    transform: mirror ? 'scaleX(-1)' : undefined,
  };

  return (
    <View style={[style, { overflow: 'hidden', backgroundColor: '#030a12' }]}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={snapshot.isLocal || !snapshot.audioEnabled}
        controls={false}
        disablePictureInPicture={false}
        style={videoStyle}
        aria-label={source === 'screen' ? 'Compartilhamento de tela' : 'Vídeo da câmera'}
      />
    </View>
  );
}
