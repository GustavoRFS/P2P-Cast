import { requireNativeView } from 'expo';
import type { P2PCastVideoViewProps } from './P2PCastMedia.types';

const NativeView = requireNativeView<P2PCastVideoViewProps>('P2PCastMedia');

export function P2PCastVideoView(props: P2PCastVideoViewProps) {
  return <NativeView {...props} />;
}

export default P2PCastVideoView;
