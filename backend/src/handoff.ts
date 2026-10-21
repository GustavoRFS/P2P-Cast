export function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]!);
}

/**
 * Hands the OAuth code to a desktop app through its custom scheme. A bare 302 is not enough:
 * when Discord skips its consent screen it redirects from script, with no user gesture, and
 * Chrome then refuses to launch the external protocol — the tab just keeps spinning. This page
 * tries the link itself and offers a button, whose click always counts as a gesture.
 */
export function handoffResponse(deepLink: string): Response {
    const href = escapeHtml(deepLink);
    // Safe inside <script>: JSON quoting plus no "<" that could close the tag.
    const scriptLiteral = JSON.stringify(deepLink).replace(/</g, "\\u003c");
    return new Response(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Login concluído</title>`
        + `<body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#07111f;color:#edf5ff">`
        + `<h1>Login concluído</h1><p>Voltando para o P2P-Cast…</p>`
        + `<p><a href="${href}" style="display:inline-block;padding:.8rem 1.4rem;border-radius:.6rem;background:#75e5e0;color:#07131f;font-weight:800;text-decoration:none">Abrir o P2P-Cast</a></p>`
        + `<p style="color:#89a1bb">Se o app não abrir sozinho, clique no botão. Depois você pode fechar esta aba.</p>`
        + `<script>location.replace(${scriptLiteral});</script></body></html>`,
        {
            status: 200,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
                // The page URL never carries the code, but keep it out of any outgoing Referer too.
                "referrer-policy": "no-referrer",
            },
        },
    );
}
