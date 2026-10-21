export function VolumeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
    return (
        <input
            type="range"
            min={0}
            max={100}
            value={Math.round(value * 100)}
            onChange={event => onChange(Number(event.target.value) / 100)}
            aria-label="Volume da transmissão"
            className="h-1 w-24 cursor-pointer accent-[#75e5e0]"
        />
    );
}
