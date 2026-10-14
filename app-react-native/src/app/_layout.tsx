import { DarkTheme, ThemeProvider, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MediaSessionProvider } from '@/session/MediaSessionProvider';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <MediaSessionProvider>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="broadcast" />
          <Stack.Screen name="watch/[peerId]" />
        </Stack>
      </ThemeProvider>
    </MediaSessionProvider>
  );
}
