import { Text, View } from 'react-native';
import type { P2PCastVideoViewProps } from './P2PCastMedia.types';

export default function P2PCastVideoView(props: P2PCastVideoViewProps) {
  return (
    <View
      {...props}
      style={[props.style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#030a12' }]}
    >
      <Text style={{ color: '#93a9c2', fontSize: 12 }}>Vídeo ao vivo disponível no app Android</Text>
    </View>
  );
}
