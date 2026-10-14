import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CHAT_MAX_MESSAGE_LENGTH, CHAT_MAX_NAME_LENGTH, formatMessageTime, sanitizeChatText } from '@/domain/chat';
import type { SessionChatMessage } from '@/session/MediaSessionProvider';
import { colors, radius, spacing } from '@/theme/tokens';

export function ChatPanel({ title, messages, canSend, onSend, emptyLabel, viewerName, onViewerNameChange }: {
  title: string;
  messages: SessionChatMessage[];
  canSend: boolean;
  onSend: (text: string) => void | Promise<void>;
  emptyLabel: string;
  viewerName?: string;
  onViewerNameChange?: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousCount = useRef(messages.length);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (open) {
      previousCount.current = messages.length;
      setUnreadCount(0);
    } else if (messages.length > previousCount.current) {
      setUnreadCount((count) => count + messages.length - previousCount.current);
      previousCount.current = messages.length;
    }
  }, [messages.length, open]);

  useEffect(() => {
    if (open) scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, open]);

  const submit = () => {
    const text = sanitizeChatText(draft);
    if (!canSend || !text) return;
    setSendError(null);
    void Promise.resolve().then(() => onSend(text)).catch(() => setSendError('Não foi possível enviar. Tente novamente.'));
    setDraft('');
  };

  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((current) => !current)} style={styles.toggle}>
        <View style={styles.chatIcon}><Text style={styles.chatIconText}>{open ? '×' : '•••'}</Text></View>
        <Text style={styles.toggleText}>{open ? 'Fechar chat' : title}</Text>
        {!open && unreadCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text></View> : null}
        <Text style={styles.toggleChevron}>{open ? '⌄' : '⌃'}</Text>
      </Pressable>

      {open ? (
        <View style={styles.panel}>
          <View style={styles.panelHeader}>
            <View><Text style={styles.panelTitle}>{title}</Text><Text style={styles.panelSubtitle}>{canSend ? 'Conversa ponto a ponto' : 'Conectando ao chat…'}</Text></View>
            <View style={[styles.readyDot, canSend && styles.readyDotOn]} />
          </View>
          {onViewerNameChange ? (
            <View style={styles.nameField}>
              <Text style={styles.nameLabel}>SEU NOME (OPCIONAL)</Text>
              <TextInput value={viewerName ?? ''} onChangeText={onViewerNameChange} placeholder="Espectador" placeholderTextColor={colors.muted} maxLength={CHAT_MAX_NAME_LENGTH} style={styles.nameInput} />
            </View>
          ) : null}
          <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messageList} keyboardShouldPersistTaps="handled">
            {messages.length === 0 ? <Text style={styles.empty}>{emptyLabel}</Text> : null}
            {messages.map((message) => (
              <View key={message.id} style={[styles.message, message.isSelf && styles.messageSelf, message.isBroadcaster && !message.isSelf && styles.messageBroadcaster]}>
                <View style={styles.messageMeta}>
                  <Text style={[styles.author, message.isSelf && styles.authorSelf]}>{message.isSelf ? 'Você' : message.authorName}</Text>
                  <Text style={styles.time}>{formatMessageTime(message.timestamp)}</Text>
                </View>
                <Text style={styles.messageText}>{message.text}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={canSend ? 'Escreva uma mensagem…' : 'Conectando ao chat…'}
              placeholderTextColor={colors.muted}
              maxLength={CHAT_MAX_MESSAGE_LENGTH}
              editable={canSend}
              returnKeyType="send"
              onSubmitEditing={submit}
              style={styles.messageInput}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" disabled={!canSend || !draft.trim()} onPress={submit} style={[styles.sendButton, (!canSend || !draft.trim()) && styles.sendDisabled]}>
              <Text style={styles.sendText}>➤</Text>
            </Pressable>
          </View>
          {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#0f2035' },
  toggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 },
  chatIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.pill, backgroundColor: '#75e5e012' },
  chatIconText: { color: colors.cyan, fontSize: 11, fontWeight: '900' },
  toggleText: { flex: 1, color: colors.text, fontSize: 11, fontWeight: '800' },
  badge: { minWidth: 19, height: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: colors.danger },
  badgeText: { color: '#2a0d10', fontSize: 9, fontWeight: '900' },
  toggleChevron: { color: colors.muted, fontSize: 16 },
  panel: { borderTopWidth: 1, borderTopColor: colors.border },
  panelHeader: { minHeight: 51, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13 },
  panelTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  panelSubtitle: { marginTop: 3, color: colors.muted, fontSize: 9 },
  readyDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.blue },
  readyDotOn: { backgroundColor: colors.green },
  nameField: { gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
  nameLabel: { color: colors.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  nameInput: { minHeight: 37, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text, backgroundColor: '#ffffff08', fontSize: 11 },
  messages: { maxHeight: 220, minHeight: 105, borderTopWidth: 1, borderTopColor: colors.border },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', gap: 8, padding: 12 },
  empty: { marginVertical: 16, color: '#6c849b', fontSize: 10, lineHeight: 15, textAlign: 'center' },
  message: { maxWidth: '90%', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 11, backgroundColor: '#ffffff08' },
  messageSelf: { alignSelf: 'flex-end', borderColor: '#75e5e047', backgroundColor: '#75e5e014' },
  messageBroadcaster: { borderColor: '#9ff1af3d', backgroundColor: '#9ff1af0d' },
  messageMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 3 },
  author: { color: colors.mutedBright, fontSize: 9, fontWeight: '800' },
  authorSelf: { color: colors.cyan },
  time: { color: '#5c7690', fontSize: 8 },
  messageText: { color: '#dfeaf7', fontSize: 11, lineHeight: 16 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border },
  messageInput: { flex: 1, minHeight: 42, paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, color: colors.text, backgroundColor: '#ffffff08', fontSize: 11 },
  sendButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.cyan },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: colors.onAccent, fontSize: 14, fontWeight: '800' },
  sendError: { marginHorizontal: 12, marginBottom: 10, color: colors.danger, fontSize: 9 },
});
