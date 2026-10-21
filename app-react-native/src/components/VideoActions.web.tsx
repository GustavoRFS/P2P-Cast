import { useEffect, useState, type ComponentRef, type RefObject } from "react";
import { View } from "react-native";
import { IconButton } from "./Button";

/** Fullscreen for the whole stage and Picture-in-Picture for the main video (browser APIs). */
export function VideoActions({
    stageRef,
    videoRef,
}: {
    stageRef: RefObject<ComponentRef<typeof View> | null>;
    videoRef: RefObject<HTMLVideoElement | null>;
}) {
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPictureInPicture, setIsPictureInPicture] = useState(false);
    // On web a View ref is the underlying DOM element.
    const stage = () => stageRef.current as unknown as HTMLElement | null;
    const pictureInPictureAvailable = typeof document !== "undefined" && document.pictureInPictureEnabled;

    useEffect(() => {
        const video = videoRef.current;
        const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === stage());
        const syncPictureInPicture = () => setIsPictureInPicture(document.pictureInPictureElement === videoRef.current);

        document.addEventListener("fullscreenchange", syncFullscreen);
        video?.addEventListener("enterpictureinpicture", syncPictureInPicture);
        video?.addEventListener("leavepictureinpicture", syncPictureInPicture);
        syncFullscreen();
        syncPictureInPicture();

        return () => {
            document.removeEventListener("fullscreenchange", syncFullscreen);
            video?.removeEventListener("enterpictureinpicture", syncPictureInPicture);
            video?.removeEventListener("leavepictureinpicture", syncPictureInPicture);
        };
    });

    const toggleFullscreen = async () => {
        const element = stage();
        if (!element || typeof element.requestFullscreen !== "function") return;
        try {
            if (document.fullscreenElement === element) await document.exitFullscreen();
            else await element.requestFullscreen();
        } catch {
            setIsFullscreen(false);
        }
    };

    const togglePictureInPicture = async () => {
        const video = videoRef.current;
        if (!video || typeof video.requestPictureInPicture !== "function") return;
        try {
            if (document.pictureInPictureElement === video) {
                await document.exitPictureInPicture();
            } else {
                if (document.pictureInPictureElement) await document.exitPictureInPicture();
                await video.requestPictureInPicture();
            }
        } catch {
            setIsPictureInPicture(false);
        }
    };

    return (
        <View className="flex-row gap-2">
            {pictureInPictureAvailable && (
                <IconButton
                    label={isPictureInPicture ? "Sair do Picture-in-Picture" : "Picture-in-Picture"}
                    glyph="PIP"
                    active={isPictureInPicture}
                    onPress={() => void togglePictureInPicture()}
                />
            )}
            <IconButton
                label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                glyph={isFullscreen ? "⤢" : "⛶"}
                active={isFullscreen}
                onPress={() => void toggleFullscreen()}
            />
        </View>
    );
}
