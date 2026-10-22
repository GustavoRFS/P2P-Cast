import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AppModal } from "../../components/AppModal";
import { Button } from "../../components/Button";
import { CaptureSettingsFields } from "../../components/CaptureSettingsFields";
import { TextField } from "../../components/Field";
import { Note, Panel, PanelHeading } from "../../components/Panel";
import { Select } from "../../components/Select";
import { formatCaptureSettings, type CaptureSettings } from "../../lib/capture";
import {
    describeTargetSelector,
    isTypingKeyAlone,
    isValidShortcut,
    sameShortcut,
    saveShortcutProfiles,
    SYSTEM_AUDIO_SOURCE,
    type ShortcutProfile,
} from "../../lib/shortcut-profiles";
import type { DesktopState } from "../session/types";
import { goToBroadcast } from "../shell/AppShell";
import { ShortcutInput } from "./ShortcutInput";

// The target a profile already has, kept when its program is not running while editing.
const SAVED_TARGET = "saved";

/**
 * The desktop's only way to broadcast the screen: each profile binds a key (or combination) to a
 * program (video and audio) and its own transmission settings. A live starts from the shortcut or
 * from the profile's card; during one, a second press of a shortcut ends it or switches to it.
 */
export function ShortcutProfiles({
    desktop,
    defaults,
    live,
    onStopLive,
}: {
    desktop: DesktopState;
    defaults: CaptureSettings;
    /** A live is on: the cards lead back to it, or switch it to their profile. */
    live: boolean;
    onStopLive(): void;
}) {
    const { captureTargets: targets, shortcutProfiles: profiles } = desktop;
    const directCaptureAvailable = desktop.config?.directVideoCaptureAvailable ?? false;
    const [formOpen, setFormOpen] = useState(false);
    // The profile being edited; null while creating one.
    const [editing, setEditing] = useState<ShortcutProfile | null>(null);
    const [name, setName] = useState("");
    const [targetId, setTargetId] = useState("");
    const [shortcut, setShortcut] = useState("");
    const [draft, setDraft] = useState<CaptureSettings>(defaults);
    const [message, setMessage] = useState("");

    useEffect(() => {
        setTargetId(current => current === SAVED_TARGET || targets.some(target => target.id === current) ? current : targets[0]?.id ?? "");
    }, [targets]);

    const persist = (next: ShortcutProfile[]) => {
        if (!saveShortcutProfiles(next)) {
            setMessage("Não foi possível salvar os atalhos neste dispositivo.");
            return false;
        }
        desktop.setShortcutProfiles(next);
        setMessage("");
        return true;
    };

    const openForm = (profile?: ShortcutProfile) => {
        setEditing(profile ?? null);
        setName(profile?.name ?? "");
        setShortcut(profile?.shortcut ?? "");
        setDraft(profile?.settings ?? defaults);
        if (profile) {
            const running = targets.find(target => target.selector === profile.videoTarget.selector);
            setTargetId(running?.id ?? SAVED_TARGET);
        }
        setMessage("");
        setFormOpen(true);
        desktop.refreshTargets();
    };

    const selectedTarget = targets.find(target => target.id === targetId);
    // Editing without picking another program keeps the profile's own target and audio source.
    const keepsSavedTarget = targetId === SAVED_TARGET && editing !== null;

    const save = () => {
        const trimmedShortcut = shortcut.trim().replace(/\s/g, "");
        if (!name.trim() || (!selectedTarget && !keepsSavedTarget) || !trimmedShortcut) {
            setMessage("Informe nome, programa e atalho.");
            return;
        }
        if (!isValidShortcut(trimmedShortcut)) {
            setMessage("Esse atalho não é aceito. Use uma tecla (como F9) ou uma combinação (como Ctrl+Shift+F9).");
            return;
        }
        const clash = profiles.find(profile => profile.id !== editing?.id && sameShortcut(profile.shortcut, trimmedShortcut));
        if (clash) {
            setMessage(`Esse atalho já é do perfil "${clash.name}".`);
            return;
        }
        const target = keepsSavedTarget
            ? { videoTarget: editing.videoTarget, audioSourceSelector: editing.audioSourceSelector }
            : {
                videoTarget: { kind: selectedTarget!.kind, selector: selectedTarget!.selector },
                // A window brings its own audio; a whole monitor brings the system's, minus Discord.
                audioSourceSelector: selectedTarget!.kind === "window" ? selectedTarget!.selector : SYSTEM_AUDIO_SOURCE,
            };
        const profile: ShortcutProfile = {
            id: editing?.id ?? crypto.randomUUID(),
            name: name.trim(),
            ...target,
            captureMethod: editing?.captureMethod ?? "direct",
            shortcut: trimmedShortcut,
            // The shortcut carries its own copy of the transmission settings.
            settings: { ...draft, source: "screen", audio: true },
        };
        const next = editing ? profiles.map(item => (item.id === editing.id ? profile : item)) : [...profiles, profile];
        if (!persist(next)) return;
        setFormOpen(false);
        setEditing(null);
    };

    const targetOptions = [
        ...(editing && !targets.some(target => target.selector === editing.videoTarget.selector)
            ? [{ value: SAVED_TARGET, label: `${describeTargetSelector(editing.videoTarget.selector)} (não está aberto)` }]
            : []),
        ...targets.map(target => ({ value: target.id, label: target.name })),
    ];
    const typingKeyAlone = isTypingKeyAlone(shortcut.trim());

    return (
        <Panel className="w-full">
            <PanelHeading
                title="Atalhos de transmissão"
                subtitle="Cada atalho transmite um programa, com vídeo e áudio, usando as próprias configurações."
            />

            {profiles.length > 0 ? (
                <View className="gap-2">
                    {profiles.map(profile => (
                        <View
                            key={profile.id}
                            className="flex-row flex-wrap items-center gap-3 rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 transition-colors duration-150 hover:border-accent/30"
                        >
                            <View className="items-center justify-center rounded-md border border-accent/30 bg-accent/10 px-2 py-1">
                                <Text className="font-mono text-[10px] font-bold text-accent">{profile.shortcut}</Text>
                            </View>
                            <View className="min-w-[140px] flex-1 gap-0.5">
                                <View className="flex-row items-center gap-2">
                                    <Text className="shrink text-[12px] font-extrabold text-ink" numberOfLines={1}>{profile.name}</Text>
                                    {live && desktop.activeProfile?.id === profile.id && (
                                        <View className="flex-row items-center gap-1 rounded-full bg-danger/15 px-1.5 py-0.5">
                                            <View className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" />
                                            <Text className="text-[8px] font-extrabold uppercase tracking-widest text-danger">ao vivo</Text>
                                        </View>
                                    )}
                                </View>
                                <Text className="text-[10px] text-muted" numberOfLines={1}>
                                    {profile.videoTarget.kind === "monitor" ? "tela inteira · áudio do sistema sem Discord · " : ""}
                                    {formatCaptureSettings(profile.settings)}
                                </Text>
                            </View>
                            <View className="flex-row items-center gap-1">
                                {!live ? (
                                    <Button
                                        size="sm"
                                        label="Iniciar live"
                                        icon={<Text className="text-[10px] font-extrabold text-ink-dark">▶</Text>}
                                        iconPosition="start"
                                        disabled={!directCaptureAvailable}
                                        onPress={() => desktop.startProfile(profile.id)}
                                    />
                                ) : desktop.activeProfile?.id === profile.id ? (
                                    <>
                                        <Button size="sm" label="Ver transmissão" onPress={goToBroadcast} />
                                        <Button
                                            size="sm"
                                            variant="danger"
                                            label="Encerrar transmissão"
                                            icon={<Text className="text-[10px] font-extrabold text-danger">■</Text>}
                                            iconPosition="start"
                                            onPress={onStopLive}
                                        />
                                    </>
                                ) : (
                                    <Button size="sm" variant="secondary" label="Trocar para este" onPress={() => desktop.switchProfile(profile.id)} />
                                )}
                                <Button size="sm" variant="ghost" label="Editar" onPress={() => openForm(profile)} />
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    label="Remover"
                                    onPress={() => persist(profiles.filter(item => item.id !== profile.id))}
                                />
                            </View>
                        </View>
                    ))}
                    <Note>
                        Com a live no ar, aperte duas vezes o atalho dela para encerrar, ou duas vezes o de outro perfil para trocar
                        a captura sem derrubar quem assiste.
                    </Note>
                </View>
            ) : (
                <Note>Nenhum atalho ainda. Crie um para transmitir um programa com uma tecla ou combinação.</Note>
            )}

            <Button label="+ Atalhos de Transmissão" onPress={() => openForm()} className="self-start" />

            {!directCaptureAvailable && desktop.config && (
                <Note tone="danger">A captura direta está indisponível: compile o helper nativo do Windows antes de usar os atalhos.</Note>
            )}
            {message && !formOpen ? <Note tone="danger">{message}</Note> : null}

            <AppModal
                visible={formOpen}
                onClose={() => setFormOpen(false)}
                title={editing ? "Editar atalho de transmissão" : "Novo atalho de transmissão"}
                subtitle="Vídeo e áudio do programa escolhido, com estas configurações."
                footer={(
                    <>
                        <Button variant="ghost" label="Cancelar" onPress={() => setFormOpen(false)} />
                        <Button label={editing ? "Salvar alterações" : "Salvar atalho"} onPress={save} />
                    </>
                )}
            >
                <View className="flex-row flex-wrap gap-3">
                    <TextField
                        className="w-full sm:w-[48%] sm:flex-grow"
                        label="Nome do atalho"
                        value={name}
                        maxLength={80}
                        onChangeText={setName}
                        placeholder="CS2"
                    />
                    <ShortcutInput className="w-full sm:w-[48%] sm:flex-grow" value={shortcut} onChange={setShortcut} />
                    {typingKeyAlone && (
                        <Note tone="danger">
                            Sozinha, essa tecla fica presa ao P2P-Cast em todo o Windows enquanto o app estiver aberto. Prefira uma
                            tecla como F9 ou uma combinação.
                        </Note>
                    )}
                    <Select
                        className="w-full"
                        label="Programa (vídeo e áudio)"
                        value={targetId}
                        options={targetOptions.length === 0 ? [{ value: "", label: "Nenhum programa detectado" }] : targetOptions}
                        onChange={setTargetId}
                    />
                    {selectedTarget?.kind === "monitor" && (
                        <Note>Tela inteira: vai junto todo o áudio do PC, menos o do Discord, para a call não voltar para quem está nela.</Note>
                    )}
                </View>
                <CaptureSettingsFields
                    fixedSource
                    settings={draft}
                    onChange={patch => setDraft(current => ({ ...current, ...patch }))}
                />
                {message ? <Note tone="danger">{message}</Note> : null}
            </AppModal>
        </Panel>
    );
}
