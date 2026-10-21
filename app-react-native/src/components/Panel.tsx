import type { ReactNode } from "react";
import { Text, View } from "react-native";

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
    return (
        <View className={`gap-3 rounded-panel border border-accent/20 bg-panel p-4 ${className}`}>
            {children}
        </View>
    );
}

export function PanelHeading({
    title,
    subtitle,
    action,
}: {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}) {
    return (
        <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
                <Text className="text-[13px] font-extrabold text-ink">{title}</Text>
                {subtitle ? <Text className="text-[11px] leading-4 text-muted">{subtitle}</Text> : null}
            </View>
            {action}
        </View>
    );
}

/** Small uppercase label used above sections, like the original "section-kicker". */
export function Kicker({ children }: { children: string }) {
    return <Text className="text-[10px] font-extrabold uppercase tracking-widest text-accent">{children}</Text>;
}

export function Note({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "danger" }) {
    return (
        <Text className={`text-[11px] leading-4 ${tone === "danger" ? "text-danger" : "text-muted"}`}>{children}</Text>
    );
}
