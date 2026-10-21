import Slider from "@react-native-community/slider";

export function VolumeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
        <Slider
            accessibilityLabel="Volume da transmissão"
            style={{ width: 110, height: 28 }}
            minimumValue={0}
            maximumValue={1}
            value={value}
            onValueChange={onChange}
            minimumTrackTintColor="#75e5e0"
            maximumTrackTintColor="rgba(173, 211, 255, 0.22)"
            thumbTintColor="#a2f7ef"
        />
    );
}
