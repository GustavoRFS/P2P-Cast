export type StreamMode =
    | "idle"
    | "starting"
    | "broadcasting"
    | "connecting"
    | "watching"
    | "error";

export interface AppError {
    title: string;
    message: string;
    details?: string;
}
