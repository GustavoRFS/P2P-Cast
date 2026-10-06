import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_CAPTURE_SETTINGS, isCaptureSettings, type CaptureSettings } from '@/domain/capture';
import {
  CHAT_MAX_NAME_LENGTH,
  CHAT_NAME_STORAGE_KEY,
  VIEWER_VOLUME_STORAGE_KEY,
  sanitizeChatName,
} from '@/domain/chat';

const CAPTURE_SETTINGS_KEY = 'p2pcast.capture-settings';
const BROADCAST_ID_KEY = 'p2pcast.broadcast-id';
const VIEWER_ID_KEY = 'p2pcast.viewer-id';

async function read(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

async function write(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    // Keep the app usable if Android storage is temporarily unavailable.
  }
}

export async function loadCaptureSettings(): Promise<CaptureSettings> {
  const stored = await read(CAPTURE_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_CAPTURE_SETTINGS };

  try {
    const parsed: unknown = JSON.parse(stored);
    return isCaptureSettings(parsed) ? parsed : { ...DEFAULT_CAPTURE_SETTINGS };
  } catch {
    return { ...DEFAULT_CAPTURE_SETTINGS };
  }
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  await write(CAPTURE_SETTINGS_KEY, JSON.stringify(settings));
}

export async function loadViewerName(): Promise<string> {
  const value = await read(CHAT_NAME_STORAGE_KEY);
  return value?.trim().slice(0, CHAT_MAX_NAME_LENGTH) ?? '';
}

export async function saveViewerName(name: string): Promise<void> {
  await write(CHAT_NAME_STORAGE_KEY, sanitizeChatName(name));
}

export async function loadViewerVolume(): Promise<number> {
  const value = await read(VIEWER_VOLUME_STORAGE_KEY);
  if (value === null) return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

export async function saveViewerVolume(volume: number): Promise<void> {
  const safeVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
  await write(VIEWER_VOLUME_STORAGE_KEY, String(safeVolume));
}

export async function loadBroadcastId(): Promise<string | null> {
  const value = (await read(BROADCAST_ID_KEY))?.trim();
  return value || null;
}

export async function saveBroadcastId(peerId: string): Promise<void> {
  await write(BROADCAST_ID_KEY, peerId.trim());
}

function createClientId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function loadOrCreateViewerId(): Promise<string> {
  const stored = (await read(VIEWER_ID_KEY))?.trim();
  if (stored) return stored;

  const id = createClientId('viewer');
  await write(VIEWER_ID_KEY, id);
  return id;
}
