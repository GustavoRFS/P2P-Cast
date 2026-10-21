import type { KeyboardEvent } from "react";
import { CONTROL_CLASS, FieldCaption, FieldLabel } from "../../components/Field";

/** Records the pressed combination (Ctrl/Alt/Shift/Super + key) instead of typed text. */
export function ShortcutInput({ value, onChange, className = "" }: { value: string; onChange: (value: string) => void; className?: string }) {
    const record = (event: KeyboardEvent<HTMLInputElement>) => {
        if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return;
        if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
        event.preventDefault();
        const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
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
            <FieldCaption>Atalho (pressione a combinação)</FieldCaption>
            <input
                aria-label="Atalho"
                value={value}
                onKeyDown={record}
                onChange={event => onChange(event.target.value)}
                placeholder="Ctrl+Shift+F9"
                className={`${CONTROL_CLASS} outline-none placeholder:text-muted-dim`}
            />
        </FieldLabel>
    );
}
