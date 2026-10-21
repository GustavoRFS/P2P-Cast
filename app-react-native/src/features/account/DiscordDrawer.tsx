import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Button } from "../../components/Button";
import type { DiscordAccount, PresenceUser } from "./types";

const DRAWER_WIDTH_CLASS = "w-[300px]";

function Avatar({ user }: { user: PresenceUser }) {
    return user.avatar ? (
        <Image source={{ uri: user.avatar }} className="h-9 w-9 rounded-full" accessibilityIgnoresInvertColors />
    ) : (
        <View className="h-9 w-9 items-center justify-center rounded-full bg-accent/20">
            <Text className="text-sm font-extrabold text-accent">{user.username.slice(0, 1).toUpperCase()}</Text>
        </View>
    );
}

/**
 * Right-hand drawer with the Discord session and everybody with the app open (tray included).
 * The handle travels with the panel, and the whole strip slides with a NativeWind transform
 * transition: CSS on web/desktop, Reanimated on Android.
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
    const liveCount = account.onlineUsers.filter(user => user.peerId !== null).length;

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

                    {!account.user ? (
                        <Text className="text-[11px] leading-4 text-muted">O login é opcional: você transmite sem entrar, mas não vê quem está online.</Text>
                    ) : account.onlineUsers.length === 0 ? (
                        <Text className="text-[11px] leading-4 text-muted">Ninguém com o app aberto agora.</Text>
                    ) : (
                        account.onlineUsers.map(user => {
                            const live = user.peerId !== null;
                            return (
                                <Pressable
                                    key={user.id}
                                    disabled={!live}
                                    accessibilityRole={live ? "button" : undefined}
                                    accessibilityLabel={live ? `Assistir ${user.username}` : `${user.username}, app aberto`}
                                    onPress={() => user.peerId && account.watch(user.peerId)}
                                    className={`flex-row items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-150 ${live ? "border-success/25 bg-success/5 hover:border-success/50 hover:bg-success/10 active:scale-[0.98]" : "border-line bg-white/[0.03] opacity-75"}`}
                                >
                                    <Avatar user={user} />
                                    <View className="flex-1 gap-0.5">
                                        <Text className="text-[12px] font-extrabold text-ink" numberOfLines={1}>{user.username}</Text>
                                        <Text className="text-[10px] text-muted" numberOfLines={1}>
                                            {live ? user.activity || "Transmitindo agora" : "App aberto"}
                                        </Text>
                                    </View>
                                    {live && <View className="h-2 w-2 animate-pulse rounded-full bg-danger" accessibilityLabel="Ao vivo" />}
                                </Pressable>
                            );
                        })
                    )}
                </ScrollView>
            </View>
        </View>
    );
}
