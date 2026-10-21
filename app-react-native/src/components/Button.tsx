import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

// Hover and press feedback come from NativeWind state variants on the Pressable: hover:
// (web/desktop), active: (every platform) and a short transition so both animate.
const CONTAINER: Record<Variant, string> = {
    primary: "bg-accent hover:bg-accent-bright shadow-lg shadow-accent/20",
    secondary: "border border-line-strong bg-white/5 hover:border-accent/40 hover:bg-white/10",
    ghost: "hover:bg-white/5",
    danger: "border border-danger/30 bg-danger-soft hover:border-danger/60 hover:bg-danger/20",
};

const LABEL: Record<Variant, string> = {
    primary: "text-ink-dark",
    secondary: "text-ink-soft group-hover/button:text-ink",
    ghost: "text-accent group-hover/button:text-accent-bright",
    danger: "text-danger",
};

const SIZE: Record<Size, { container: string; label: string }> = {
    sm: { container: "rounded-lg px-3 py-2", label: "text-xs" },
    md: { container: "rounded-[9px] px-4 py-3", label: "text-sm" },
    lg: { container: "rounded-xl px-6 py-4", label: "text-base" },
};

export function Button({
    label,
    variant = "primary",
    size = "md",
    icon,
    iconPosition = "end",
    loading = false,
    className = "",
    disabled,
    ...props
}: Omit<PressableProps, "children"> & {
    label: string;
    variant?: Variant;
    size?: Size;
    icon?: ReactNode;
    iconPosition?: "start" | "end";
    loading?: boolean;
    className?: string;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            disabled={disabled || loading}
            className={`group/button flex-row items-center justify-center gap-2 transition-all duration-150 ease-out active:scale-95 active:opacity-90 disabled:opacity-45 ${SIZE[size].container} ${CONTAINER[variant]} ${className}`}
            {...props}
        >
            {loading && <ActivityIndicator size="small" color={variant === "primary" ? "#07131f" : "#75e5e0"} />}
            {iconPosition === "start" && icon}
            <Text className={`font-extrabold transition-colors duration-150 ${SIZE[size].label} ${LABEL[variant]}`}>{label}</Text>
            {iconPosition === "end" && icon}
        </Pressable>
    );
}

/** Compact square control used over video and in panel headers. */
export function IconButton({
    label,
    glyph,
    active = false,
    className = "",
    ...props
}: Omit<PressableProps, "children"> & { label: string; glyph: string; active?: boolean; className?: string }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            className={`group/icon h-9 min-w-9 items-center justify-center rounded-lg border px-2 transition-all duration-150 ease-out active:scale-90 ${active ? "border-accent/50 bg-accent/15" : "border-line bg-bg/70 hover:border-accent/40 hover:bg-white/10"} ${className}`}
            {...props}
        >
            <Text className="text-sm font-bold text-ink-soft transition-colors duration-150 group-hover/icon:text-accent">{glyph}</Text>
        </Pressable>
    );
}
