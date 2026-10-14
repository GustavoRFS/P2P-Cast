export const DEFAULT_WEB_ORIGIN = 'https://p2p-cast-react-native-beta.vercel.app';

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
}

export function parseWatchTarget(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const appLink = value.match(/^p2pcast-react-native:\/\/watch\/([^?#]+)/i);
  if (appLink?.[1]) return decode(appLink[1]);

  const queryStart = value.indexOf('?');
  if (queryStart >= 0) {
    const query = value.slice(queryStart + 1).split('#', 1)[0] ?? '';
    const watchPair = query
      .split('&')
      .map((pair) => {
        const separator = pair.indexOf('=');
        return separator < 0 ? null : [pair.slice(0, separator), pair.slice(separator + 1)] as const;
      })
      .find((pair) => pair?.[0] === 'watch');
    return watchPair ? decode(watchPair[1]) : null;
  }

  return value.includes('://') ? null : value;
}

export function buildWatchUrl(origin: string, peerId: string): string {
  const cleanOrigin = origin.trim().replace(/\/+$/, '');
  return `${cleanOrigin}/?watch=${encodeURIComponent(peerId)}`;
}

export function createViewerSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
