import { CONTROL_CLASS, FieldCaption, FieldLabel } from "./Field";
import type { SelectProps } from "./select-types";

export type { SelectOption } from "./select-types";

/** On web and desktop a real <select>: native keyboard, accessibility and OS styling of the list. */
export function Select<T extends string>({ label, value, options, onChange, disabled, className = "" }: SelectProps<T>) {
    return (
        <FieldLabel className={className}>
            <FieldCaption>{label}</FieldCaption>
            <select
                aria-label={label}
                value={value}
                disabled={disabled}
                onChange={event => onChange(event.target.value as T)}
                className={`${CONTROL_CLASS} cursor-pointer outline-none disabled:cursor-not-allowed disabled:opacity-50`}
            >
                {options.map(option => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </option>
                ))}
            </select>
        </FieldLabel>
    );
}
