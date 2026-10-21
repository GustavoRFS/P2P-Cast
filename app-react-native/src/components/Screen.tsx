import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Brand } from "./Brand";

/** Logo-only header: everybody knows what the app does. */
export function AppHeader({ right }: { right?: ReactNode }) {
    return (
        <View className="w-full max-w-6xl flex-row items-center justify-between self-center px-4 py-4 md:px-8 md:py-6">
            <Brand />
            {right}
        </View>
    );
}

/** Page shell: safe area, header and a centered column that widens with the breakpoints. */
export function Screen({
    children,
    headerRight,
    scroll = true,
    className = "",
}: {
    children: ReactNode;
    headerRight?: ReactNode;
    scroll?: boolean;
    className?: string;
}) {
    const content = (
        <View className={`w-full max-w-6xl flex-1 gap-5 self-center px-4 pb-10 md:px-8 ${className}`}>
            {children}
        </View>
    );

    return (
        <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
            <AppHeader right={headerRight} />
            {scroll ? (
                <ScrollView contentContainerClassName="flex-grow" keyboardShouldPersistTaps="handled">
                    {content}
                </ScrollView>
            ) : content}
        </SafeAreaView>
    );
}
