import { View } from "react-native";
import {
    BITRATE_OPTIONS,
    CURSOR_OPTIONS,
    FPS_OPTIONS,
    getAvailableCaptureSourceOptions,
    getCaptureSources,
    RESOLUTION_OPTIONS,
    type CaptureSettings,
} from "../lib/capture";
import { Select } from "./Select";

type Update = (patch: Partial<CaptureSettings>) => void;

/**
 * Transmission settings as one responsive grid: one column on phones, two from `sm:` up.
 * `fixedSource` hides the source picker (shortcut profiles always send the screen).
 */
export function CaptureSettingsFields({
    settings,
    onChange,
    fixedSource = false,
    screenAudioAvailable = true,
}: {
    settings: CaptureSettings;
    onChange: Update;
    fixedSource?: boolean;
    screenAudioAvailable?: boolean;
}) {
    const sources = getCaptureSources(settings.source);
    const sendsScreen = sources.includes("screen");
    const sendsCamera = sources.includes("camera");
    const cell = "w-full sm:w-[48%] sm:flex-grow";

    return (
        <View className="flex-row flex-wrap gap-3">
            {!fixedSource && (
                <Select
                    className={cell}
                    label="Fonte da transmissão"
                    value={settings.source}
                    options={getAvailableCaptureSourceOptions().map(option => ({ value: option.value, label: option.label }))}
                    onChange={source => onChange({ source })}
                />
            )}
            <Select
                className={cell}
                label="Resolução"
                value={settings.resolution}
                options={RESOLUTION_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                onChange={resolution => onChange({ resolution })}
            />
            <Select
                className={cell}
                label="FPS"
                value={String(settings.fps)}
                options={FPS_OPTIONS.map(fps => ({ value: String(fps), label: `${fps} FPS` }))}
                onChange={fps => onChange({ fps: Number(fps) as CaptureSettings["fps"] })}
            />
            <Select
                className={cell}
                label="Bitrate"
                value={settings.bitrate === null ? "auto" : String(settings.bitrate)}
                options={BITRATE_OPTIONS.map(option => ({
                    value: option.value === null ? "auto" : String(option.value),
                    label: option.label,
                }))}
                onChange={bitrate => onChange({
                    bitrate: bitrate === "auto" ? null : Number(bitrate) as CaptureSettings["bitrate"],
                })}
            />
            {sendsScreen && (
                <Select
                    className={cell}
                    label="Cursor"
                    value={settings.cursor}
                    options={CURSOR_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
                    onChange={cursor => onChange({ cursor })}
                />
            )}
            {sendsScreen && !fixedSource && (
                <Select
                    className={cell}
                    label="Áudio da tela"
                    value={settings.audio ? "on" : "off"}
                    options={[
                        { value: "on", label: "Ligado", disabled: !screenAudioAvailable },
                        { value: "off", label: "Desligado" },
                    ]}
                    onChange={audio => onChange({ audio: audio === "on" })}
                />
            )}
            {(sendsCamera || fixedSource) && (
                <Select
                    className={cell}
                    label="Microfone"
                    value={settings.microphone ? "on" : "off"}
                    options={[
                        { value: "on", label: "Ligado" },
                        { value: "off", label: "Desligado" },
                    ]}
                    onChange={microphone => onChange({ microphone: microphone === "on" })}
                />
            )}
            {sendsCamera && (
                <Select
                    className={cell}
                    label="Câmera"
                    value={settings.cameraFacing}
                    options={[
                        { value: "user", label: "Frontal" },
                        { value: "environment", label: "Traseira" },
                    ]}
                    onChange={cameraFacing => onChange({ cameraFacing })}
                />
            )}
        </View>
    );
}
