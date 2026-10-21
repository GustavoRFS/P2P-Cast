import type { ReactNode } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

// Shared look for every form control: the same surface the selects use.
export const CONTROL_CLASS =
    "min-h-9 w-full rounded-[7px] border border-line-strong bg-field px-2.5 text-[12px] font-bold text-ink transition-colors duration-150 hover:border-accent/40 focus:border-accent/70";

export function FieldLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <View className={`gap-1.5 ${className}`}>
            {children}
        </View>
    );
}

export function FieldCaption({ children }: { children: string }) {
    return <Text className="text-[9px] font-extrabold uppercase tracking-widest text-muted">{children}</Text>;
}

export function TextField({
    label,
    className = "",
    ...props
}: TextInputProps & { label: string; className?: string }) {
    return (
        <FieldLabel className={className}>
            <FieldCaption>{label}</FieldCaption>
            <TextInput
                placeholderTextColor="#6d8ba6"
                accessibilityLabel={label}
                className={CONTROL_CLASS}
                {...props}
            />
        </FieldLabel>
    );
}
