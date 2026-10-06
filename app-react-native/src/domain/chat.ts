export interface ChatMessage {
  id: string;
  authorName: string;
  text: string;
  timestamp: number;
  isBroadcaster: boolean;
}

export const CHAT_CONNECTION_ROLE = 'chat';
export const CHAT_NAME_STORAGE_KEY = 'p2pcast.viewer-name';
export const CHAT_SOUND_STORAGE_KEY = 'p2pcast.chat-sound';
export const VIEWER_VOLUME_STORAGE_KEY = 'p2pcast.viewer-volume';
export const CHAT_MAX_MESSAGE_LENGTH = 500;
export const CHAT_MAX_NAME_LENGTH = 40;

export function sanitizeChatText(value: string): string {
  return value.trim().slice(0, CHAT_MAX_MESSAGE_LENGTH);
}

export function sanitizeChatName(value: string): string {
  return value.trim().slice(0, CHAT_MAX_NAME_LENGTH);
}

export function resolveAuthorName(value: string | undefined, viewerIndex: number): string {
  return sanitizeChatName(value ?? '') || `Espectador ${viewerIndex}`;
}

export function shouldPlayChatNotification(chatOpen: boolean, soundEnabled: boolean): boolean {
  return !chatOpen && soundEnabled;
}

export function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function buildChatMessage(params: {
  text: string;
  authorName: string;
  isBroadcaster: boolean;
}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
    authorName: sanitizeChatName(params.authorName),
    text: sanitizeChatText(params.text),
    timestamp: Date.now(),
    isBroadcaster: params.isBroadcaster,
  };
}
