import { router } from "expo-router";
import { useState } from "react";
import { Button } from "../../components/Button";
import { TextField } from "../../components/Field";
import { Note, Panel, PanelHeading } from "../../components/Panel";
import { parseWatchInput } from "../../lib/room";

/** Paste a share link (or just the id) and open the viewer. */
export function WatchLinkPanel({ className = "" }: { className?: string }) {
    const [input, setInput] = useState("");
    const [invalid, setInvalid] = useState(false);

    const open = () => {
        const peerId = parseWatchInput(input);
        if (!peerId) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        router.push({ pathname: "/watch/[peerId]", params: { peerId } });
    };

    return (
        <Panel className={className}>
            <PanelHeading title="Assistir" subtitle="Cole o link que seu amigo mandou." />
            <TextField
                label="Link da transmissão"
                value={input}
                onChangeText={text => {
                    setInput(text);
                    if (invalid) setInvalid(false);
                }}
                onSubmitEditing={open}
                placeholder="https://live.ligmacharl.es/?watch=…"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
            />
            {invalid && <Note tone="danger">Esse texto não é um link de transmissão.</Note>}
            <Button variant="secondary" label="Assistir" onPress={open} disabled={!input.trim()} className="self-start" />
        </Panel>
    );
}
