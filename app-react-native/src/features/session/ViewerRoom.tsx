import { router } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { Screen } from "../../components/Screen";
import { ErrorCard, MODE_LABELS, StatusPill } from "../../components/Status";
import { VideoStage } from "../../components/VideoStage";
import { VolumeSlider } from "../../components/VolumeSlider";
import { hasAnyMedia } from "./media";
import { useViewerSession } from "./useViewerSession";

function leave() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
}

/** Watching a broadcast from its link. */
export function ViewerRoom({ peerId }: { peerId: string }) {
    const viewer = useViewerSession(peerId);
    const live = hasAnyMedia(viewer.remoteMedia);

    return (
        <Screen headerRight={<StatusPill mode={viewer.mode} />}>
            <Panel>
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="text-[10px] font-bold uppercase tracking-widest text-muted">transmissão ao vivo</Text>
                    <Text className="text-[10px] font-bold uppercase tracking-widest text-muted">conexão ponto a ponto</Text>
                </View>
                <VideoStage
                    media={viewer.remoteMedia}
                    badge="AO VIVO"
                    muted={!viewer.audioOn}
                    volume={viewer.volume}
                    placeholder={viewer.mode === "error" ? (
                        <Text className="text-[12px] text-muted">A transmissão não está disponível.</Text>
                    ) : (
                        <>
                            <ActivityIndicator color="#75e5e0" />
                            <Text className="text-[12px] text-muted">{MODE_LABELS[viewer.mode]}…</Text>
                        </>
                    )}
                    audioControl={live ? (
                        <>
                            <VolumeSlider value={viewer.volume} onChange={viewer.setVolume} />
                            <Text className="w-9 text-[10px] font-bold text-muted-bright">{Math.round(viewer.volume * 100)}%</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ selected: viewer.audioOn }}
                                onPress={viewer.toggleAudio}
                                className="rounded-full px-2 py-1 transition-colors duration-150 hover:bg-white/10 active:scale-95"
                            >
                                <Text className="text-[11px] font-extrabold text-ink">
                                    {viewer.audioOn ? "🔊 Mutar" : "🔇 Ativar áudio"}
                                </Text>
                            </Pressable>
                        </>
                    ) : undefined}
                    chat={{ title: "Chat com quem está assistindo", state: viewer.chat, emptyLabel: "Nenhuma mensagem ainda. Mande um oi." }}
                />
            </Panel>

            {viewer.error && <ErrorCard error={viewer.error} onRetry={viewer.retry} />}

            <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Text className="text-[11px] text-muted">⌁ conexão WebRTC criptografada</Text>
                <Button variant="secondary" label="Sair da sala" onPress={leave} />
            </View>
        </Screen>
    );
}
