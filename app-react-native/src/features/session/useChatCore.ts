import { useCallback, useEffect, useRef, useState } from "react";
import {
    loadChatSoundEnabled,
    saveChatSoundEnabled,
    shouldPlayChatNotification,
    type ChatMessage,
} from "../../lib/chat";
import { createChatNotificationPlayer, type ChatNotificationPlayer } from "../../lib/chat-sound";
import type { DisplayChatMessage } from "./types";

/** Chat panel state shared by the broadcaster and the viewer: messages, unread count, sound. */
export function useChatCore() {
    const [messages, setMessages] = useState<DisplayChatMessage[]>([]);
    const [open, setOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [soundEnabled, setSoundEnabled] = useState(loadChatSoundEnabled);
    const openRef = useRef(false);
    const soundEnabledRef = useRef(soundEnabled);
    const playerRef = useRef<ChatNotificationPlayer | null>(null);

    useEffect(() => {
        const player = createChatNotificationPlayer();
        playerRef.current = player;

        return () => {
            playerRef.current = null;
            void player.dispose();
        };
    }, []);

    useEffect(() => {
        openRef.current = open;
    }, [open]);

    useEffect(() => {
        soundEnabledRef.current = soundEnabled;
        saveChatSoundEnabled(soundEnabled);
    }, [soundEnabled]);

    const toggle = useCallback(() => {
        void playerRef.current?.unlock();
        setOpen(current => {
            const next = !current;
            if (next) setUnread(0);
            return next;
        });
    }, []);

    const toggleSound = useCallback(() => {
        void playerRef.current?.unlock();
        setSoundEnabled(current => !current);
    }, []);

    const pushSelf = useCallback((message: ChatMessage) => {
        setMessages(current => [...current, { ...message, isSelf: true }]);
    }, []);

    const pushIncoming = useCallback((message: ChatMessage) => {
        setMessages(current => [...current, { ...message, isSelf: false }]);
        setUnread(current => (openRef.current ? current : current + 1));
        if (shouldPlayChatNotification(openRef.current, soundEnabledRef.current)) {
            void playerRef.current?.play();
        }
    }, []);

    const reset = useCallback(() => {
        setMessages([]);
        setOpen(false);
        setUnread(0);
    }, []);

    return { messages, open, unread, soundEnabled, toggle, toggleSound, pushSelf, pushIncoming, reset };
}
