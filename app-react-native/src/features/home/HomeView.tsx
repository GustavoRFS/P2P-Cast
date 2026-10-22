import { Text, View } from "react-native";
import { Button } from "../../components/Button";
import { CaptureSettingsFields } from "../../components/CaptureSettingsFields";
import { Panel, PanelHeading } from "../../components/Panel";
import { Screen } from "../../components/Screen";
import { ErrorCard } from "../../components/Status";
import { useBroadcast } from "../session/BroadcastProvider";
import { goToBroadcast } from "../shell/AppShell";
import { WatchLinkPanel } from "./WatchLinkPanel";

/**
 * Web and Android home: create a broadcast link or open one. Side by side from `md:` up, stacked
 * on phones. During a live it leads back to the live room instead of starting another.
 */
export function HomeView() {
    const broadcast = useBroadcast();
    const live = broadcast.mode === "broadcasting";

    return (
        <View className="flex-1 bg-bg">
            <Screen>
                {broadcast.error && (
                    <ErrorCard
                        error={broadcast.error}
                        onRetry={() => void broadcast.start()}
                        onDismiss={broadcast.clearError}
                    />
                )}
                <View className="gap-5 md:flex-row md:items-start">
                    {live ? (
                        <Panel className="md:flex-[3]">
                            <PanelHeading
                                title="Você está transmitindo"
                                subtitle={`${broadcast.viewerCount} ${broadcast.viewerCount === 1 ? "pessoa assistindo" : "pessoas assistindo"}. A live continua enquanto você navega.`}
                            />
                            <View className="flex-row flex-wrap gap-3">
                                <Button size="lg" label="Ver transmissão" onPress={goToBroadcast} className="flex-grow sm:flex-grow-0" />
                                <Button
                                    size="lg"
                                    variant="danger"
                                    label="Encerrar transmissão"
                                    icon={<Text className="text-sm font-extrabold text-danger">■</Text>}
                                    iconPosition="start"
                                    onPress={broadcast.stop}
                                    className="flex-grow sm:flex-grow-0"
                                />
                            </View>
                        </Panel>
                    ) : (
                        <Panel className="md:flex-[3]">
                            <PanelHeading title="Transmitir" subtitle="Escolha o que mostrar e gere o link da sala." />
                            <CaptureSettingsFields
                                settings={broadcast.settings}
                                onChange={patch => broadcast.setSettings(current => ({ ...current, ...patch }))}
                            />
                            <Button
                                size="lg"
                                label={broadcast.mode === "starting" ? "Preparando…" : "Gerar link"}
                                loading={broadcast.mode === "starting"}
                                onPress={() => void broadcast.start()}
                                className="self-stretch sm:self-start"
                            />
                        </Panel>
                    )}
                    <WatchLinkPanel className="md:flex-[2]" />
                </View>
            </Screen>
        </View>
    );
}
