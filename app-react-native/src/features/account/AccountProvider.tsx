import { createContext, useContext, useState, type ReactNode } from "react";
import { createAccountPlatform } from "./account-platform";
import type { DiscordAccount } from "./types";
import { useDiscordAccount } from "./useDiscordAccount";

const AccountContext = createContext<DiscordAccount | null>(null);

/** One Discord account per app; null where the platform has no account (the public web page). */
export function AccountProvider({ children }: { children: ReactNode }) {
    const [platform] = useState(createAccountPlatform);
    const account = useDiscordAccount(platform);

    return (
        <AccountContext.Provider value={platform ? account : null}>
            {children}
        </AccountContext.Provider>
    );
}

export function useAccount(): DiscordAccount | null {
    return useContext(AccountContext);
}
