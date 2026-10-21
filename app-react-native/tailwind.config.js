/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{js,jsx,ts,tsx}"],
    presets: [require("nativewind/preset")],
    theme: {
        extend: {
            // Palette carried over from the original web client (web/src/index.css).
            colors: {
                bg: { DEFAULT: "#07111f", soft: "#0b1829" },
                panel: { DEFAULT: "rgba(14, 29, 49, 0.82)", solid: "#0f2035", deep: "#081726" },
                field: "#132a44",
                line: { DEFAULT: "rgba(173, 211, 255, 0.14)", strong: "rgba(173, 211, 255, 0.22)" },
                ink: { DEFAULT: "#edf5ff", soft: "#cfe6ff", dark: "#07131f" },
                muted: { DEFAULT: "#89a1bb", bright: "#aec1d7", dim: "#6d8ba6" },
                accent: { DEFAULT: "#75e5e0", bright: "#a2f7ef", line: "rgba(117, 229, 224, 0.22)" },
                success: "#9ff1af",
                info: "#91b7ff",
                danger: { DEFAULT: "#ff9898", soft: "rgba(255, 152, 152, 0.12)" },
            },
            borderRadius: {
                panel: "14px",
            },
        },
    },
    plugins: [],
};
