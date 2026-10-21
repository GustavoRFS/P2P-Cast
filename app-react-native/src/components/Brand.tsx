import { Text, View } from "react-native";

/** The three-bar signal mark and the "p2pcast" wordmark from the original header. */
export function Brand() {
    return (
        <View className="flex-row items-center gap-2.5" accessibilityRole="header" accessibilityLabel="P2P-Cast">
            <View className="h-6 w-6 flex-row items-end gap-[3px]">
                <View className="h-[11px] flex-1 rounded-t-[4px] rounded-b-[2px] bg-accent opacity-60" />
                <View className="h-[18px] flex-1 rounded-t-[4px] rounded-b-[2px] bg-accent" />
                <View className="h-[14px] flex-1 rounded-t-[4px] rounded-b-[2px] bg-accent opacity-80" />
            </View>
            <Text className="text-[17px] font-extrabold tracking-tight text-ink">
                p2p<Text className="text-accent">cast</Text>
            </Text>
        </View>
    );
}
