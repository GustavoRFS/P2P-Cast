import { createContext, useContext, type ReactNode } from "react";
import { useAccount } from "../account/AccountProvider";
import type { BroadcastSession } from "./types";
import { useBroadcastSession } from "./useBroadcastSession";

const BroadcastContext = createContext<BroadcastSession | null>(null);

/**
 * The broadcast lives at the root so it survives navigation and a desktop shortcut can start it
 * from any screen; presence learns the peer id through the account.
 */
export function BroadcastProvider({ children }: { children: ReactNode }) {
    const account = useAccount();
    const session = useBroadcastSession(account?.setLivePeer);

    return <BroadcastContext.Provider value={session}>{children}</BroadcastContext.Provider>;
}

export function useBroadcast(): BroadcastSession {
    const session = useContext(BroadcastContext);
    if (!session) throw new Error("useBroadcast must be used inside BroadcastProvider");
    return session;
}
