import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { CONTROL_CLASS, FieldCaption, FieldLabel } from "./Field";
import type { SelectProps } from "./select-types";

export type { SelectOption } from "./select-types";

/** Native select: the field opens a sheet with the options. */
export function Select<T extends string>({ label, value, options, onChange, disabled, className = "" }: SelectProps<T>) {
    const [open, setOpen] = useState(false);
    const current = options.find(option => option.value === value);

    return (
        <FieldLabel className={className}>
            <FieldCaption>{label}</FieldCaption>
            <Pressable
                accessibilityRole="combobox"
                accessibilityLabel={label}
                accessibilityState={{ disabled, expanded: open }}
                disabled={disabled}
                onPress={() => setOpen(true)}
                className={`${CONTROL_CLASS} flex-row items-center justify-between active:opacity-80 disabled:opacity-50`}
            >
                <Text className="flex-1 text-[12px] font-bold text-ink" numberOfLines={1}>{current?.label ?? "—"}</Text>
                <Text className="text-[11px] text-muted">▾</Text>
            </Pressable>

            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setOpen(false)}>
                    <Pressable className="max-h-[70%] rounded-t-2xl border-t border-accent/20 bg-panel-deep pb-6" onPress={() => undefined}>
                        <Text className="px-5 pb-2 pt-4 text-[10px] font-extrabold uppercase tracking-widest text-muted">{label}</Text>
                        <FlatList
                            data={options}
                            keyExtractor={option => option.value}
                            renderItem={({ item }) => (
                                <Pressable
                                    disabled={item.disabled}
                                    onPress={() => {
                                        onChange(item.value);
                                        setOpen(false);
                                    }}
                                    className={`flex-row items-center justify-between px-5 py-3.5 active:bg-white/10 disabled:opacity-40 ${item.value === value ? "bg-accent/10" : ""}`}
                                >
                                    <Text className={`text-sm font-bold ${item.value === value ? "text-accent" : "text-ink"}`}>{item.label}</Text>
                                    {item.value === value ? <Text className="text-accent">✓</Text> : null}
                                </Pressable>
                            )}
                        />
                    </Pressable>
                </Pressable>
            </Modal>
        </FieldLabel>
    );
}
