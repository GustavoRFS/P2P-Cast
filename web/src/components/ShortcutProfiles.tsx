import { useEffect, useState, type KeyboardEvent } from "react";
import type { CaptureSettings } from "../lib/capture";
import {
    loadShortcutProfiles,
    saveShortcutProfiles,
    type ShortcutProfile,
} from "../lib/shortcut-profiles";

type Target = DesktopCaptureTarget;

export function ShortcutProfiles({
    targets,
    host,
    directCaptureAvailable,
    settings,
    onRefresh,
    onChange,
}: {
    targets: Target[];
    host: "electron" | "tauri";
    directCaptureAvailable: boolean;
    settings: CaptureSettings;
    onRefresh: () => void;
    onChange: (profiles: ShortcutProfile[]) => void;
}) {
    const [profiles, setProfiles] = useState(loadShortcutProfiles);
    const [name, setName] = useState("");
    const [targetId, setTargetId] = useState("");
    const [audioId, setAudioId] = useState("");
    const [shortcut, setShortcut] = useState("");
    const [method, setMethod] = useState<ShortcutProfile["captureMethod"]>(host === "tauri" ? "windows-picker" : "direct");
    const [message, setMessage] = useState("");

    useEffect(() => {
        setTargetId(current => targets.some(target => target.id === current) ? current : targets[0]?.id ?? "");
        setAudioId(current => targets.some(target => target.id === current && target.kind === "window")
            ? current
            : targets.find(target => target.kind === "window")?.id ?? "");
    }, [targets]);

    const persist = (next: ShortcutProfile[]) => {
        if (!saveShortcutProfiles(next)) {
            setMessage("Não foi possível salvar os atalhos neste dispositivo.");
            return;
        }
        setProfiles(next);
        onChange(next);
        setMessage("");
    };

    const selectedTarget = targets.find(target => target.id === targetId);
    const windowTargets = targets.filter(target => target.kind === "window");
    const recordShortcut = (event: KeyboardEvent<HTMLInputElement>) => {
        if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return;
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        event.preventDefault();
        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        setShortcut([
            ...(event.ctrlKey ? ["Ctrl"] : []),
            ...(event.altKey ? ["Alt"] : []),
            ...(event.shiftKey ? ["Shift"] : []),
            ...(event.metaKey ? ["Super"] : []),
            key,
        ].join("+"));
    };
    const save = () => {
        if (!name.trim() || !selectedTarget || !audioId || !shortcut.trim()) {
            setMessage("Informe nome, alvo de vídeo, programa de áudio e atalho.");
            return;
        }
        const profile: ShortcutProfile = {
            id: crypto.randomUUID(),
            name: name.trim(),
            videoTarget: { kind: selectedTarget.kind, selector: selectedTarget.selector },
            captureMethod: method,
            audioSourceSelector: targets.find(target => target.id === audioId)?.selector ?? "",
            shortcut: shortcut.trim().replace(/\s/g, ""),
            settings: { ...settings, source: "screen", audio: true },
        };
        persist([...profiles, profile]);
        setName("");
        setShortcut("");
    };

    return (
        <section className="shortcut-profiles" aria-label="Atalhos de transmissão">
            <div className="desktop-panel-heading">
                <div><strong>Atalhos de transmissão</strong><span>Inicie uma captura com vídeo e áudio deste programa.</span></div>
                <button type="button" className="text-button" onClick={onRefresh}>Atualizar programas</button>
            </div>
            {profiles.length > 0 && <ul className="shortcut-profile-list">
                {profiles.map(profile => <li key={profile.id}>
                    <span><strong>{profile.name}</strong><small>{profile.shortcut} · {profile.videoTarget.kind === "monitor" ? "tela inteira" : "janela"}</small></span>
                    <button type="button" className="text-button" onClick={() => persist(profiles.filter(item => item.id !== profile.id))}>Remover</button>
                </li>)}
            </ul>}
            <label className="capture-setting"><span>Nome do atalho</span><input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="CS2" /></label>
            <label className="capture-setting"><span>Vídeo</span><select value={targetId} onChange={event => setTargetId(event.target.value)}>
                {targets.length === 0 && <option value="">Nenhum programa detectado</option>}
                {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select></label>
            {host === "tauri" && <label className="capture-setting"><span>Método de captura</span><select value={method} onChange={event => setMethod(event.target.value as ShortcutProfile["captureMethod"])}>
                <option value="direct" disabled={!directCaptureAvailable}>{directCaptureAvailable ? "Captura direta" : "Captura direta (helper indisponível)"}</option><option value="windows-picker">Seletor do Windows</option>
            </select></label>}
            {host === "tauri" && <p className="desktop-audio-note">{method === "windows-picker" ? "O seletor do Windows pede que você escolha a janela ou o monitor a cada início; o alvo de vídeo salvo não pode ser imposto pelo seletor." : "A captura direta abre o alvo salvo sem mostrar o seletor do Windows."}</p>}
            <label className="capture-setting"><span>Áudio do programa</span><select value={audioId} onChange={event => setAudioId(event.target.value)}>
                {windowTargets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
            </select></label>
            <label className="capture-setting"><span>Atalho (pressione a combinação)</span><input value={shortcut} onKeyDown={recordShortcut} onChange={event => setShortcut(event.target.value)} placeholder="Ctrl+Shift+F9" /></label>
            <button type="button" className="primary-button" onClick={save}>Salvar atalho</button>
            {message && <p className="desktop-audio-note" role="status">{message}</p>}
        </section>
    );
}
