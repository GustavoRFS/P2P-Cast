import { useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import {
    loadToastCorner,
    PRESENCE_STATUS_OPTIONS,
    saveToastCorner,
    type PresenceStatus,
    type ToastCorner,
    TOAST_CORNER_OPTIONS,
} from "../../lib/presence-prefs";
import { getAppPlatform } from "../../platform";
import type { DiscordAccount, PresenceUser } from "./types";

const DRAWER_WIDTH_CLASS = "w-[300px]";

const STATUS_DOT: Record<PresenceStatus, string> = {
    online: "bg-success",
    busy: "bg-danger",
    invisible: "bg-muted-dim",
};

function describe(user: PresenceUser): string {
    if (user.status === "invisible") return user.peerId ? "Invisível — sua live não aparece" : "Invisível — ninguém te vê";
    if (user.peerId) return user.activity || "Transmitindo agora";
    return user.status === "busy" ? "Ocupado" : "App aberto";
}

/** Live first, then online, then busy; alphabetical inside each group. */
function byPresence(left: PresenceUser, right: PresenceUser): number {
    const rank = (user: PresenceUser) => (user.peerId ? 0 : user.status === "busy" ? 2 : 1);
    return rank(left) - rank(right) || left.username.localeCompare(right.username);
}

function Avatar({ user }: { user: PresenceUser }) {
    return (
        <View className="relative">
            {user.avatar ? (
                <Image source={{ uri: user.avatar }} className="h-9 w-9 rounded-full" accessibilityIgnoresInvertColors />
            ) : (
                <View className="h-9 w-9 items-center justify-center rounded-full bg-accent/20">
                    <Text className="text-sm font-extrabold text-accent">{user.username.slice(0, 1).toUpperCase()}</Text>
                </View>
            )}
            <View className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel-deep ${STATUS_DOT[user.status]}`} />
        </View>
    );
}

function PresenceRow({ user, onWatch, preview = false }: { user: PresenceUser; onWatch?: (peerId: string) => void; preview?: boolean }) {
    const live = user.peerId !== null;
    const watchable = live && !preview && onWatch;
    const dimmed = user.status === "invisible" || (!live && user.status === "busy");

    return (
        <Pressable
            disabled={!watchable}
            accessibilityRole={watchable ? "button" : undefined}
            accessibilityLabel={watchable ? `Assistir ${user.username}` : `${user.username}, ${describe(user)}`}
            onPress={() => user.peerId && onWatch?.(user.peerId)}
            className={`flex-row items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 ${
                live && !preview
                    ? "border-success/25 bg-success/5 hover:border-success/50 hover:bg-success/10 active:scale-[0.98]"
                    : preview
                        ? `border-dashed ${user.status === "invisible" ? "border-line" : "border-accent/30"} bg-accent/5`
                        : "border-line bg-white/[0.03]"
            } ${dimmed ? "opacity-70" : ""}`}
        >
            <Avatar user={user} />
            <View className="flex-1 gap-0.5">
                <Text className="text-[12px] font-extrabold text-ink" numberOfLines={1}>{user.username}</Text>
                <Text className="text-[10px] text-muted" numberOfLines={1}>{describe(user)}</Text>
            </View>
            {live && user.status !== "invisible" && <View className="h-2 w-2 animate-pulse rounded-full bg-danger" accessibilityLabel="Ao vivo" />}
        </Pressable>
    );
}

function StatusPicker({ value, onChange }: { value: PresenceStatus; onChange: (status: PresenceStatus) => void }) {
    const current = PRESENCE_STATUS_OPTIONS.find(option => option.value === value);
    return (
        <View className="gap-1.5">
            <View className="flex-row gap-1 rounded-xl border border-line bg-bg/60 p-1">
                {PRESENCE_STATUS_OPTIONS.map(option => {
                    const selected = option.value === value;
                    return (
                        <Pressable
                            key={option.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            onPress={() => onChange(option.value)}
                            className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-1.5 transition-all duration-150 active:scale-95 ${selected ? "bg-white/10" : "hover:bg-white/5"}`}
                        >
                            <View className={`h-2 w-2 rounded-full ${STATUS_DOT[option.value]}`} />
                            <Text className={`text-[10px] font-extrabold ${selected ? "text-ink" : "text-muted"}`}>{option.label}</Text>
                        </Pressable>
                    );
                })}
            </View>
            {current ? <Text className="text-[10px] leading-4 text-muted">{current.description}</Text> : null}
        </View>
    );
}

function SectionLabel({ children }: { children: string }) {
    return <Text className="mt-1 text-[9px] font-extrabold uppercase tracking-widest text-muted">{children}</Text>;
}

/**
 * Right-hand drawer with the Discord session and everybody with the app open (tray included).
 * You come first, as a preview of how the others see you. The handle travels with the panel, and
 * the whole strip slides with a NativeWind transform transition: CSS on web/desktop, Reanimated on
 * Android.
 */
export function DiscordDrawer({
    account,
    open,
    onToggle,
}: {
    account: DiscordAccount;
    open: boolean;
    onToggle: () => void;
}) {
    const [corner, setCorner] = useState<ToastCorner>(loadToastCorner);
    const liveCount = account.onlineUsers.filter(user => user.peerId !== null).length;
    const desktop = getAppPlatform() === "desktop";

    return (
        <View
            pointerEvents="box-none"
            className={`absolute bottom-0 right-0 top-0 z-30 flex-row items-start transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-[300px]"}`}
        >
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={open ? "Fechar painel do Discord" : "Abrir painel do Discord"}
                accessibilityState={{ expanded: open }}
                onPress={onToggle}
                className="group/handle mt-24 flex-row items-center gap-1.5 rounded-l-xl border border-r-0 border-accent/25 bg-panel-deep/95 px-3 py-2.5 transition-all duration-200 hover:border-accent/60 hover:pr-4 active:scale-95"
            >
                <Text className="text-xs text-accent transition-transform duration-300">{open ? "›" : "‹"}</Text>
                <Text className="text-[10px] font-extrabold uppercase tracking-widest text-ink-soft group-hover/handle:text-ink">Discord</Text>
                {liveCount > 0 && (
                    <View className="min-w-4 items-center rounded-full bg-accent px-1">
                        <Text className="text-[9px] font-extrabold text-ink-dark">{liveCount}</Text>
                    </View>
                )}
            </Pressable>

            <View className={`h-full ${DRAWER_WIDTH_CLASS} border-l border-accent/20 bg-panel-deep/95 shadow-2xl shadow-black`}>
                <View className="flex-row items-start justify-between gap-3 border-b border-line px-4 pb-4 pt-6">
                    <View className="flex-1 gap-1">
                        <Text className="text-[13px] font-extrabold text-ink" numberOfLines={1}>
                            {account.user ? account.user.username : "Discord"}
                        </Text>
                        <Text className="text-[10px] text-muted">
                            {account.user ? "Presença sincronizada" : "Entre para ver quem está online"}
                        </Text>
                    </View>
                    {account.user ? (
                        <Button size="sm" variant="ghost" label="Sair" onPress={() => void account.signOut()} />
                    ) : (
                        <Button
                            size="sm"
                            variant="secondary"
                            label={account.loading ? "Carregando…" : "Entrar"}
                            loading={account.loading}
                            onPress={() => void account.signIn()}
                        />
                    )}
                </View>

                <ScrollView contentContainerClassName="gap-2 p-4">
                    {account.error ? <Text className="text-[11px] leading-4 text-danger">{account.error}</Text> : null}

                    {!account.user || !account.self ? (
                        <Text className="text-[11px] leading-4 text-muted">O login é opcional: você transmite sem entrar, mas não vê quem está online.</Text>
                    ) : (
                        <>
                            <StatusPicker value={account.status} onChange={account.setStatus} />

                            <SectionLabel>Como os outros te veem</SectionLabel>
                            <PresenceRow user={account.self} preview />

                            <SectionLabel>{`No app agora · ${account.onlineUsers.length}`}</SectionLabel>
                            {account.onlineUsers.length === 0 ? (
                                <Text className="text-[11px] leading-4 text-muted">Mais ninguém com o app aberto.</Text>
                            ) : (
                                [...account.onlineUsers].sort(byPresence).map(user => (
                                    <PresenceRow key={user.id} user={user} onWatch={account.watch} />
                                ))
                            )}

                            {desktop && (
                                <View className="mt-3 gap-2 border-t border-line pt-3">
                                    <Select
                                        label="Aviso de live"
                                        value={corner}
                                        options={TOAST_CORNER_OPTIONS}
                                        onChange={next => {
                                            setCorner(next);
                                            saveToastCorner(next);
                                        }}
                                    />
                                    <Text className="text-[10px] leading-4 text-muted">
                                        {account.status === "busy" ? "Você está ocupado: nenhum aviso aparece." : "Aparece no canto escolhido, por cima de tudo, sem tirar o foco do jogo."}
                                    </Text>
                                    {account.previewLiveNotification ? (
                                        <Button
                                            size="sm"
                                            variant="secondary"
                                            label="Prever notificação"
                                            accessibilityLabel="Prever notificação de live"
                                            icon={<Text className="text-[10px] text-accent">▶</Text>}
                                            iconPosition="start"
                                            className="self-start"
                                            onPress={account.previewLiveNotification}
                                        />
                                    ) : null}
                                </View>
                            )}
                        </>
                    )}
                </ScrollView>
            </View>
        </View>
    );
}
