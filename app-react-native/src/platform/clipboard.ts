import * as Clipboard from "expo-clipboard";

export async function writeClipboardText(text: string): Promise<void> {
    await Clipboard.setStringAsync(text);
}
