import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AppModal } from "../../components/AppModal";
import { Button } from "../../components/Button";
import { CaptureSettingsFields } from "../../components/CaptureSettingsFields";
import { TextField } from "../../components/Field";
import { Note, Panel, PanelHeading } from "../../components/Panel";
import { Select } from "../../components/Select";
import { formatCaptureSettings, type CaptureSettings } from "../../lib/capture";
import { saveShortcutProfiles, SYSTEM_AUDIO_SOURCE, type ShortcutProfile } from "../../lib/shortcut-profiles";
import type { DesktopState } from "../session/types";
import { ShortcutInput } from "./ShortcutInput";

/**
 * The desktop's only way to broadcast the screen: each profile binds a key combination to a
 * program (video and audio) and its own transmission settings.
 */
export function ShortcutProfiles({
    desktop,
    defaults,
}: {
    desktop: DesktopState;
    defaults: CaptureSettings;
}) {
    const { captureTargets: targets, shortcutProfiles: profiles } = desktop;
    const directCaptureAvailable = desktop.config?.directVideoCaptureAvailable ?? false;
    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState("");
    const [targetId, setTargetId] = useState("");
    const [shortcut, setShortcut] = useState("");
    const [draft, setDraft] = useState<CaptureSettings>(defaults);
    const [message, setMessage] = useState("");

    useEffect(() => {
        setTargetId(current => targets.some(target => target.id === current) ? current : targets[0]?.id ?? "");
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

    const openForm = () => {
        setDraft(defaults);
        setMessage("");
        setFormOpen(true);
        desktop.refreshTargets();
    };

    const selectedTarget = targets.find(target => target.id === targetId);

    const save = () => {
        if (!name.trim() || !selectedTarget || !shortcut.trim()) {
            setMessage("Informe nome, programa e atalho.");
            return;
        }
        const profile: ShortcutProfile = {
            id: crypto.randomUUID(),
            name: name.trim(),
            videoTarget: { kind: selectedTarget.kind, selector: selectedTarget.selector },
            captureMethod: "direct",
            // A window brings its own audio; a whole monitor brings the system's, minus Discord.
            audioSourceSelector: selectedTarget.kind === "window" ? selectedTarget.selector : SYSTEM_AUDIO_SOURCE,
            shortcut: shortcut.trim().replace(/\s/g, ""),
            // The shortcut carries its own copy of the transmission settings.
            settings: { ...draft, source: "screen", audio: true },
        };
        if (!persist([...profiles, profile])) return;
        setName("");
        setShortcut("");
        setFormOpen(false);
    };

    return (
        <Panel className="w-full">
            <PanelHeading title="Atalhos de transmissão" subtitle="Cada atalho transmite um programa, com vídeo e áudio, usando as próprias configurações." />

            {profiles.length > 0 ? (
                <View className="gap-2">
                    {profiles.map(profile => (
                        <View
                            key={profile.id}
                            className="flex-row items-center gap-3 rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 transition-colors duration-150 hover:border-accent/30"
                        >
                            <View className="items-center justify-center rounded-md border border-accent/30 bg-accent/10 px-2 py-1">
                                <Text className="font-mono text-[10px] font-bold text-accent">{profile.shortcut}</Text>
                            </View>
                            <View className="flex-1 gap-0.5">
                                <Text className="text-[12px] font-extrabold text-ink" numberOfLines={1}>{profile.name}</Text>
                                <Text className="text-[10px] text-muted" numberOfLines={1}>
                                    {profile.videoTarget.kind === "monitor" ? "tela inteira · áudio do sistema sem Discord · " : ""}
                                    {formatCaptureSettings(profile.settings)}
                                </Text>
                            </View>
                            <Button
                                size="sm"
                                variant="ghost"
                                label="Remover"
                                onPress={() => persist(profiles.filter(item => item.id !== profile.id))}
                            />
                        </View>
                    ))}
                </View>
            ) : (
                <Note>Nenhum atalho ainda. Crie um para transmitir um programa com uma combinação de teclas.</Note>
            )}

            <Button label="+ Atalhos de Transmissão" onPress={openForm} className="self-start" />

            {!directCaptureAvailable && desktop.config && (
                <Note tone="danger">A captura direta está indisponível: compile o helper nativo do Windows antes de usar os atalhos.</Note>
            )}
            {message && !formOpen ? <Note tone="danger">{message}</Note> : null}

            <AppModal
                visible={formOpen}
                onClose={() => setFormOpen(false)}
                title="Novo atalho de transmissão"
                subtitle="Vídeo e áudio do programa escolhido, com estas configurações."
                footer={(
                    <>
                        <Button variant="ghost" label="Cancelar" onPress={() => setFormOpen(false)} />
                        <Button label="Salvar atalho" onPress={save} />
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
                    <Select
                        className="w-full"
                        label="Programa (vídeo e áudio)"
                        value={targetId}
                        options={targets.length === 0
                            ? [{ value: "", label: "Nenhum programa detectado" }]
                            : targets.map(target => ({ value: target.id, label: target.name }))}
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
