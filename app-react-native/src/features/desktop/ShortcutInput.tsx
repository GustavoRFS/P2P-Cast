import { TextField } from "../../components/Field";

// Global shortcuts exist only in the desktop shell; native keeps a plain text field.
export function ShortcutInput({ value, onChange, className = "" }: { value: string; onChange: (value: string) => void; className?: string }) {
    return <TextField className={className} label="Atalho" value={value} onChangeText={onChange} placeholder="Ctrl+Shift+F9" />;
}
