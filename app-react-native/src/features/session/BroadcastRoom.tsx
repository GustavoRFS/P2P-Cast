import { router } from "expo-router";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Button, IconButton } from "../../components/Button";
import { Note, Panel, PanelHeading } from "../../components/Panel";
import { Screen } from "../../components/Screen";
import { ErrorCard, StatusPill } from "../../components/Status";
import { VideoStage } from "../../components/VideoStage";
import { formatCaptureSettings } from "../../lib/capture";
import { useBroadcast } from "./BroadcastProvider";
import { mediaHasAudio } from "./media";
import type { NativeSenderInfo } from "./types";

function formatBitrate(bitrate: number): string {
    return `${(bitrate / 1_000_000).toFixed(bitrate % 1_000_000 === 0 ? 0 : 1)} Mbps`;
}

/** The live keeps going: home (or wherever the user came from), back here through the drawer. */
function goHome() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
}

/** In place of the local preview: the app is encoding and sending the live itself. */
function NativeSenderStatus({ sender }: { sender: NativeSenderInfo }) {
    const { encoder } = sender;
    return (
        <>
            <Text className="text-[13px] font-extrabold text-ink">Enviando direto do app</Text>
            {encoder ? (
                <Text className="text-center text-[11px] text-muted">
                    H.264 · {encoder.name} · {encoder.width}×{encoder.height} · {encoder.fps} fps · {formatBitrate(encoder.bitrate)}
                </Text>
            ) : (
                <>
                    <ActivityIndicator color="#75e5e0" />
                    <Text className="text-[11px] text-muted">Preparando o codificador…</Text>
                </>
            )}
            <Text className="text-center text-[11px] text-muted">A prévia fica desligada para não pesar no jogo.</Text>
        </>
    );
}

/** The live room for the broadcaster: local preview, viewers, chat and the share link. */
export function BroadcastRoom() {
    const broadcast = useBroadcast();
    const { localMedia, chat, nativeSender } = broadcast;
    const hasAudio = Boolean(nativeSender) || mediaHasAudio(localMedia);

    return (
        <Screen headerRight={<StatusPill mode={broadcast.mode} />}>
            <Button
                size="sm"
                variant="ghost"
                label="← Início"
                accessibilityLabel="Voltar ao início sem encerrar a live"
                onPress={goHome}
                className="self-start"
            />
            <View className="gap-5 lg:flex-row lg:items-start">
                <Panel className="lg:flex-[3]">
                    <View className="flex-row flex-wrap items-center justify-between gap-2">
                        <Text className="text-[10px] font-bold uppercase tracking-widest text-muted">
                            {nativeSender ? "envio nativo" : "prévia local"}
                            {broadcast.desktop?.activeProfile ? ` · ${broadcast.desktop.activeProfile.name}` : ""}
                            {" · "}{formatCaptureSettings(broadcast.settings)}
                        </Text>
                        <Text className="text-[11px] font-extrabold text-success">
                            ◉ {broadcast.viewerCount} {broadcast.viewerCount === 1 ? "pessoa assistindo" : "pessoas assistindo"}
                        </Text>
                    </View>
                    <VideoStage
                        media={localMedia}
                        badge="LOCAL"
                        placeholder={nativeSender ? <NativeSenderStatus sender={nativeSender} /> : (
                            <>
                                <ActivityIndicator color="#75e5e0" />
                                <Text className="text-[12px] text-muted">Aguardando o compartilhamento…</Text>
                            </>
                        )}
                        extraActions={localMedia.camera ? (
                            <IconButton
                                label={broadcast.settings.cameraFacing === "environment" ? "Usar câmera frontal" : "Usar câmera traseira"}
                                glyph="⟲"
                                onPress={() => void broadcast.flipCamera()}
                            />
                        ) : undefined}
                        audioControl={hasAudio ? (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ selected: !broadcast.audioMuted }}
                                onPress={broadcast.toggleAudio}
                                className="rounded-full px-2 py-1 transition-colors duration-150 hover:bg-white/10 active:scale-95"
                            >
                                <Text className="text-[11px] font-extrabold text-ink">
                                    {broadcast.audioMuted ? "🔇 Ativar áudio" : "🔊 Mutar áudio"}
                                </Text>
                            </Pressable>
                        ) : undefined}
                        chat={{ title: "Chat com espectadores", state: chat, emptyLabel: "Nenhuma mensagem ainda. Diga oi para quem está assistindo." }}
                    />
                </Panel>

                <Panel className="lg:flex-[2]">
                    <PanelHeading title="O link é a sala" subtitle="Quando você encerrar, ele deixa de funcionar." />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Copiar link da transmissão"
                        disabled={!broadcast.shareUrl}
                        onPress={() => void broadcast.copyShareUrl()}
                        className="flex-row items-center gap-2 rounded-lg border border-line-strong bg-field px-3 py-2.5 transition-colors duration-150 hover:border-accent/50 active:opacity-80"
                    >
                        <Text className="flex-1 font-mono text-[11px] text-ink-soft" numberOfLines={1} selectable>
                            {broadcast.shareUrl ?? "gerando seu link…"}
                        </Text>
                        <Text className="text-sm text-accent">{broadcast.copied ? "✓" : "⧉"}</Text>
                    </Pressable>
                    <Button
                        label={broadcast.copied ? "Link copiado" : "Copiar link"}
                        icon={<Text className="font-extrabold text-ink-dark">{broadcast.copied ? "✓" : "⧉"}</Text>}
                        disabled={!broadcast.shareUrl}
                        onPress={() => void broadcast.copyShareUrl()}
                    />
                    <Note>O vídeo vai direto para seus amigos, sem servidor de vídeo no meio.</Note>
                </Panel>
            </View>

            {broadcast.error && <ErrorCard error={broadcast.error} onDismiss={broadcast.clearError} />}

            <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <Text className="text-[11px] text-muted">⌁ conexão WebRTC criptografada</Text>
                <Button variant="danger" label="Encerrar transmissão" onPress={broadcast.stop} />
            </View>
        </Screen>
    );
}
