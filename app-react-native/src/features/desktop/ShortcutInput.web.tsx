import type { KeyboardEvent } from "react";
import { CONTROL_CLASS, FieldCaption, FieldLabel } from "../../components/Field";

// event.key names for the keys the global-shortcut plugin calls otherwise.
const KEY_NAMES: Record<string, string> = {
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
};

/** Records the pressed key, alone (F9) or with Ctrl/Alt/Shift/Super, instead of typed text. */
export function ShortcutInput({ value, onChange, className = "" }: { value: string; onChange: (value: string) => void; className?: string }) {
    const record = (event: KeyboardEvent<HTMLInputElement>) => {
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        const modified = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
        // Alone, Tab still moves the focus and Escape still closes the window.
        if (!modified && (event.key === "Tab" || event.key === "Escape")) return;
        event.preventDefault();
        if (!modified && (event.key === "Backspace" || event.key === "Delete")) {
            onChange("");
            return;
        }
        const key = KEY_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
        onChange([
            ...(event.ctrlKey ? ["Ctrl"] : []),
            ...(event.altKey ? ["Alt"] : []),
            ...(event.shiftKey ? ["Shift"] : []),
            ...(event.metaKey ? ["Super"] : []),
            key,
        ].join("+"));
    };

    return (
        <FieldLabel className={className}>
            <FieldCaption>Atalho (pressione a tecla ou a combinação)</FieldCaption>
            <input
                aria-label="Atalho"
                value={value}
                onKeyDown={record}
                onChange={event => onChange(event.target.value)}
                placeholder="F9 ou Ctrl+Shift+F9"
                className={`${CONTROL_CLASS} outline-none placeholder:text-muted-dim`}
            />
        </FieldLabel>
    );
}
