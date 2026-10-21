import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { IconButton } from "./Button";

/** Centered dialog; the backdrop, Escape (web) and back (Android) close it. */
export function AppModal({
    visible,
    onClose,
    title,
    subtitle,
    children,
    footer,
}: {
    visible: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    children: ReactNode;
    footer?: ReactNode;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable
                accessibilityLabel="Fechar"
                className="flex-1 items-center justify-center bg-black/70 p-4 md:p-8"
                onPress={onClose}
            >
                <Pressable className="max-h-full w-full max-w-xl" onPress={() => undefined} aria-modal>
                    <View className="max-h-full overflow-hidden rounded-2xl border border-accent/20 bg-panel-deep shadow-2xl shadow-black">
                        <View className="flex-row items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-5">
                            <View className="flex-1 gap-1">
                                <Text className="text-[15px] font-extrabold text-ink" accessibilityRole="header">{title}</Text>
                                {subtitle ? <Text className="text-[11px] leading-4 text-muted">{subtitle}</Text> : null}
                            </View>
                            <IconButton label="Fechar" glyph="×" onPress={onClose} />
                        </View>
                        <ScrollView contentContainerClassName="gap-4 p-5" keyboardShouldPersistTaps="handled">
                            {children}
                        </ScrollView>
                        {footer ? <View className="flex-row items-center justify-end gap-3 border-t border-line px-5 py-4">{footer}</View> : null}
                    </View>
                </Pressable>
            </Pressable>
        </Modal>
    );
}
