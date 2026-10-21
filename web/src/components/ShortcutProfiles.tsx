import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
    BITRATE_OPTIONS,
    CURSOR_OPTIONS,
    FPS_OPTIONS,
    RESOLUTION_OPTIONS,
    formatCaptureSettings,
    type CaptureSettings,
} from "../lib/capture";
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
    const [formOpen, setFormOpen] = useState(false);
    const [name, setName] = useState("");
    const [targetId, setTargetId] = useState("");
    const [shortcut, setShortcut] = useState("");
    const [draft, setDraft] = useState<CaptureSettings>(settings);
    const [message, setMessage] = useState("");

    useEffect(() => {
        setTargetId(current => targets.some(target => target.id === current) ? current : targets[0]?.id ?? "");
    }, [targets]);

    useEffect(() => {
        if (!formOpen) return;

        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setFormOpen(false);
        };

        document.addEventListener("keydown", closeOnEscape);
        return () => document.removeEventListener("keydown", closeOnEscape);
    }, [formOpen]);

    const persist = (next: ShortcutProfile[]) => {
        if (!saveShortcutProfiles(next)) {
            setMessage("Não foi possível salvar os atalhos neste dispositivo.");
            return;
        }
        setProfiles(next);
        onChange(next);
        setMessage("");
    };

    const openForm = () => {
        setDraft(settings);
        setMessage("");
        setFormOpen(true);
        onRefresh();
    };

    const selectedTarget = targets.find(target => target.id === targetId);
    const recordShortcut = (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
        if (!name.trim() || !selectedTarget || !shortcut.trim()) {
            setMessage("Informe nome, programa e atalho.");
            return;
        }
        if (selectedTarget.kind !== "window") {
            setMessage("O áudio isolado precisa de uma janela de programa; um monitor inteiro não tem áudio próprio.");
            return;
        }
        const profile: ShortcutProfile = {
            id: crypto.randomUUID(),
            name: name.trim(),
            videoTarget: { kind: selectedTarget.kind, selector: selectedTarget.selector },
            captureMethod: "direct",
            audioSourceSelector: selectedTarget.selector,
            shortcut: shortcut.trim().replace(/\s/g, ""),
            // The shortcut carries its own copy of the transmission settings.
            settings: { ...draft, source: "screen", audio: true },
        };
        persist([...profiles, profile]);
        setName("");
        setShortcut("");
        setFormOpen(false);
    };

    return (
        <section className="shortcut-profiles" aria-label="Atalhos de transmissão">
            {profiles.length > 0 ? (
                <ul className="shortcut-profile-list">
                    {profiles.map(profile => <li key={profile.id}>
                        <span>
                            <strong>{profile.name}</strong>
                            <small>{profile.shortcut} · {profile.videoTarget.kind === "monitor" ? "tela inteira" : "janela"}</small>
                            <small>{formatCaptureSettings(profile.settings)}</small>
                        </span>
                        <button type="button" className="text-button" onClick={() => persist(profiles.filter(item => item.id !== profile.id))}>Remover</button>
                    </li>)}
                </ul>
            ) : (
                <p className="shortcut-empty">Nenhum atalho ainda. Crie um para transmitir um programa com uma combinação de teclas.</p>
            )}

            <button type="button" className="button button-primary" onClick={openForm}>
                + Atalhos de Transmissão
            </button>

            {host === "tauri" && !directCaptureAvailable && (
                <p className="desktop-audio-note">A captura direta está indisponível: compile o helper nativo do Windows antes de usar os atalhos.</p>
            )}
            {message && !formOpen && <p className="desktop-audio-note" role="status">{message}</p>}

            {formOpen && (
                <div className="modal-backdrop" role="presentation" onClick={() => setFormOpen(false)}>
                    <div
                        className="modal-card"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="shortcut-form-title"
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="capture-settings-heading">
                            <div>
                                <strong id="shortcut-form-title">Novo atalho de transmissão</strong>
                                <span>Vídeo e áudio do programa escolhido, com estas configurações</span>
                            </div>
                            <button
                                className="settings-close"
                                type="button"
                                onClick={() => setFormOpen(false)}
                                aria-label="Fechar"
                            >
                                ×
                            </button>
                        </div>

                        <div className="capture-settings-fields">
                            <label className="capture-setting">
                                <span>Nome do atalho</span>
                                <input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="CS2" />
                            </label>
                            <label className="capture-setting">
                                <span>Atalho (pressione a combinação)</span>
                                <input value={shortcut} onKeyDown={recordShortcut} onChange={event => setShortcut(event.target.value)} placeholder="Ctrl+Shift+F9" />
                            </label>
                            <label className="capture-setting capture-setting-wide">
                                <span>Programa (vídeo e áudio)</span>
                                <select value={targetId} onChange={event => setTargetId(event.target.value)}>
                                    {targets.length === 0 && <option value="">Nenhum programa detectado</option>}
                                    {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
                                </select>
                            </label>
                            <label className="capture-setting">
                                <span>Resolução</span>
                                <select
                                    value={draft.resolution}
                                    onChange={event => setDraft(current => ({ ...current, resolution: event.target.value as CaptureSettings["resolution"] }))}
                                >
                                    {RESOLUTION_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="capture-setting">
                                <span>FPS</span>
                                <select
                                    value={draft.fps}
                                    onChange={event => setDraft(current => ({ ...current, fps: Number(event.target.value) as CaptureSettings["fps"] }))}
                                >
                                    {FPS_OPTIONS.map(fps => <option key={fps} value={fps}>{fps} FPS</option>)}
                                </select>
                            </label>
                            <label className="capture-setting">
                                <span>Bitrate</span>
                                <select
                                    value={draft.bitrate === null ? "auto" : String(draft.bitrate)}
                                    onChange={event => setDraft(current => ({
                                        ...current,
                                        bitrate: event.target.value === "auto" ? null : Number(event.target.value) as CaptureSettings["bitrate"],
                                    }))}
                                >
                                    {BITRATE_OPTIONS.map(option => (
                                        <option key={option.label} value={option.value === null ? "auto" : String(option.value)}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="capture-setting">
                                <span>Cursor</span>
                                <select
                                    value={draft.cursor}
                                    onChange={event => setDraft(current => ({ ...current, cursor: event.target.value as CaptureSettings["cursor"] }))}
                                >
                                    {CURSOR_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="capture-setting">
                                <span>Microfone</span>
                                <select
                                    value={draft.microphone ? "on" : "off"}
                                    onChange={event => setDraft(current => ({ ...current, microphone: event.target.value === "on" }))}
                                >
                                    <option value="on">Ligado</option>
                                    <option value="off">Desligado</option>
                                </select>
                            </label>
                        </div>

                        {message && <p className="desktop-audio-note" role="status">{message}</p>}

                        <div className="modal-actions">
                            <button type="button" className="text-button" onClick={() => setFormOpen(false)}>Cancelar</button>
                            <button type="button" className="button button-primary" onClick={save}>Salvar atalho</button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
