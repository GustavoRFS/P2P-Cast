import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { CHAT_MAX_MESSAGE_LENGTH, CHAT_MAX_NAME_LENGTH, formatMessageTime } from "../lib/chat";
import type { ChatState } from "../features/session/types";
import { IconButton } from "./Button";

/** Floating chat in the corner of the video stage: a toggle with the unread badge and the panel. */
export function ChatPanel({ title, chat, emptyLabel }: { title: string; chat: ChatState; emptyLabel: string }) {
    const [draft, setDraft] = useState("");
    const listRef = useRef<ComponentRef<typeof ScrollView>>(null);

    useEffect(() => {
        if (chat.open) listRef.current?.scrollToEnd({ animated: true });
    }, [chat.open, chat.messages]);

    const submit = () => {
        const text = draft.trim();
        if (!text || !chat.ready) return;
        chat.send(text);
        setDraft("");
    };

    return (
        // Spans the stage below the corner actions, so the panel adapts to however tall the stage is.
        <View className="absolute bottom-3 right-3 top-14 z-20 items-end justify-end gap-2" pointerEvents="box-none">
            {chat.open && (
                <View
                    accessibilityLabel={title}
                    className="max-h-96 w-[260px] flex-1 overflow-hidden rounded-panel border border-accent/20 bg-panel-deep/95 shadow-2xl shadow-black md:w-80"
                >
                    <View className="flex-row items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                        <Text className="flex-1 text-[12px] font-extrabold text-ink" numberOfLines={1}>{title}</Text>
                        <IconButton
                            label={chat.soundEnabled ? "Desativar sons do chat" : "Ativar sons do chat"}
                            glyph={chat.soundEnabled ? "🔔" : "🔕"}
                            active={chat.soundEnabled}
                            onPress={chat.toggleSound}
                        />
                        <IconButton label="Fechar chat" glyph="×" onPress={chat.toggle} />
                    </View>

                    {chat.setName && (
                        <View className="gap-1 border-b border-line px-3 py-2">
                            <Text className="text-[9px] font-extrabold uppercase tracking-widest text-muted">Seu nome (opcional)</Text>
                            <TextInput
                                value={chat.name ?? ""}
                                onChangeText={chat.setName}
                                placeholder="Espectador"
                                placeholderTextColor="#6d8ba6"
                                maxLength={CHAT_MAX_NAME_LENGTH}
                                className="rounded-md border border-line bg-field px-2 py-1.5 text-[12px] text-ink focus:border-accent/60"
                            />
                        </View>
                    )}

                    <ScrollView ref={listRef} className="flex-1" contentContainerClassName="gap-2 p-3">
                        {chat.messages.length === 0 && <Text className="text-center text-[11px] leading-4 text-muted">{emptyLabel}</Text>}
                        {chat.messages.map(message => (
                            <View
                                key={message.id}
                                className={`max-w-[88%] gap-0.5 rounded-xl px-3 py-2 ${message.isSelf ? "self-end bg-accent/15" : message.isBroadcaster ? "self-start border border-accent/30 bg-white/5" : "self-start bg-white/5"}`}
                            >
                                <View className="flex-row items-center gap-2">
                                    <Text className={`text-[10px] font-extrabold ${message.isBroadcaster ? "text-accent" : "text-muted-bright"}`}>
                                        {message.isSelf ? "Você" : message.authorName}
                                    </Text>
                                    <Text className="text-[9px] text-muted">{formatMessageTime(message.timestamp)}</Text>
                                </View>
                                <Text className="text-[12px] leading-5 text-ink">{message.text}</Text>
                            </View>
                        ))}
                    </ScrollView>

                    <View className="flex-row items-center gap-2 border-t border-line p-2">
                        <TextInput
                            value={draft}
                            onChangeText={setDraft}
                            onSubmitEditing={submit}
                            editable={chat.ready}
                            placeholder={chat.ready ? "Escreva uma mensagem…" : "Conectando ao chat…"}
                            placeholderTextColor="#6d8ba6"
                            maxLength={CHAT_MAX_MESSAGE_LENGTH}
                            returnKeyType="send"
                            className="flex-1 rounded-md border border-line bg-field px-2.5 py-2 text-[12px] text-ink focus:border-accent/60 disabled:opacity-50"
                        />
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Enviar mensagem"
                            disabled={!chat.ready || !draft.trim()}
                            onPress={submit}
                            className="h-9 w-9 items-center justify-center rounded-md bg-accent transition-all duration-150 hover:bg-accent-bright active:scale-90 disabled:opacity-40"
                        >
                            <Text className="text-sm font-extrabold text-ink-dark">➤</Text>
                        </Pressable>
                    </View>
                </View>
            )}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={chat.open ? "Fechar chat" : "Abrir chat"}
                accessibilityState={{ expanded: chat.open }}
                onPress={chat.toggle}
                className="h-11 w-11 items-center justify-center rounded-full border border-accent/30 bg-panel-deep/90 shadow-lg shadow-black transition-all duration-150 hover:scale-105 hover:border-accent/60 active:scale-90"
            >
                <Text className="text-base text-ink">{chat.open ? "×" : "💬"}</Text>
                {!chat.open && chat.unread > 0 && (
                    <View className="absolute -right-1 -top-1 min-w-[18px] items-center rounded-full bg-accent px-1">
                        <Text className="text-[10px] font-extrabold text-ink-dark">{chat.unread > 9 ? "9+" : chat.unread}</Text>
                    </View>
                )}
            </Pressable>
        </View>
    );
}
