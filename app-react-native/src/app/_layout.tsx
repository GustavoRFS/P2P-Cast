import "../global.css";

import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";

const theme = {
    ...DarkTheme,
    colors: {
        ...DarkTheme.colors,
        background: "#07111f",
        card: "#07111f",
        primary: "#75e5e0",
        text: "#edf5ff",
        border: "rgba(173, 211, 255, 0.14)",
    },
};

export default function RootLayout() {
    return (
        <ThemeProvider value={theme}>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#07111f" } }} />
        </ThemeProvider>
    );
}
