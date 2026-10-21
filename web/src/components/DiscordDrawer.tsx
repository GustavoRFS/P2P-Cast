import type { DesktopAccount } from "../lib/desktop-account";

export function DiscordDrawer({
    account,
    open,
    onToggle,
}: {
    account: DesktopAccount | null;
    open: boolean;
    onToggle: () => void;
}) {
    const onlineUsers = account?.onlineUsers ?? [];
    const liveCount = onlineUsers.filter(user => user.peerId !== null).length;

    return (
        <>
            <button
                type="button"
                className={open ? "drawer-handle is-open" : "drawer-handle"}
                onClick={onToggle}
                aria-expanded={open}
                aria-controls="discord-drawer"
            >
                <span aria-hidden="true">{open ? "›" : "‹"}</span>
                <span className="drawer-handle-label">
                    Discord
                    {liveCount > 0 && <span className="drawer-handle-count">{liveCount}</span>}
                </span>
            </button>

            <aside
                id="discord-drawer"
                className={open ? "discord-drawer is-open" : "discord-drawer"}
                aria-label="Discord e quem está com o app aberto"
            >
                <div className="discord-drawer-heading">
                    <div>
                        <strong>{account?.user ? account.user.username : "Discord"}</strong>
                        <span>{account?.user ? "Presença sincronizada" : "Entre para ver quem está online"}</span>
                    </div>
                    {account?.user ? (
                        <button type="button" className="text-button" onClick={() => void account.signOut()}>Sair</button>
                    ) : (
                        <button
                            type="button"
                            className="button button-secondary button-small"
                            onClick={() => void account?.signIn()}
                            disabled={!account}
                        >
                            {account?.loading ? "Carregando…" : "Entrar"}
                        </button>
                    )}
                </div>

                {account?.error && <p className="desktop-account-error" role="status">{account.error}</p>}

                {!account?.user ? (
                    <p className="desktop-account-empty">O login é opcional: você transmite sem entrar, mas não vê quem está online.</p>
                ) : onlineUsers.length === 0 ? (
                    <p className="desktop-account-empty">Ninguém com o app aberto agora.</p>
                ) : (
                    <div className="desktop-live-users">
                        {onlineUsers.map(user => {
                            const live = user.peerId !== null;
                            const avatar = user.avatar
                                ? <img src={user.avatar} alt="" />
                                : <span className="desktop-user-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>;
                            const copy = (
                                <span className="desktop-live-user-copy">
                                    <strong>{user.username}</strong>
                                    <small>{live ? user.activity || "Transmitindo agora" : "App aberto"}</small>
                                </span>
                            );

                            return live ? (
                                <button
                                    key={user.id}
                                    type="button"
                                    className="desktop-live-user"
                                    onClick={() => account.watch(user.peerId!)}
                                >
                                    {avatar}
                                    {copy}
                                    <span className="desktop-live-dot" aria-label="Ao vivo" />
                                </button>
                            ) : (
                                <div key={user.id} className="desktop-live-user is-idle">
                                    {avatar}
                                    {copy}
                                </div>
                            );
                        })}
                    </div>
                )}
            </aside>
        </>
    );
}
