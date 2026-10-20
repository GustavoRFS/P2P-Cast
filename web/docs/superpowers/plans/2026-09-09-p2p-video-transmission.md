# P2P Video Transmission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir um app React estático que compartilhe uma transmissão de tela por WebRTC usando o PeerServer em `peerjs.ligmacharl.es` para sinalização e um link com o ID do transmissor.

**Architecture:** O frontend cria um peer PeerJS para o transmissor e outro para cada espectador. O PeerServer em `peerjs.ligmacharl.es` troca a sinalização; a mídia usa WebRTC diretamente entre os navegadores quando ICE consegue uma rota direta. O app usa query string (`?watch=<peer-id>`) para decidir entre tela inicial, transmissão e espectador, sem roteador ou backend próprio.

**Tech Stack:** React, TypeScript, Vite, PeerJS (`peerjs`), Vitest para helpers puros, CSS nativo.

**Spec:** `docs/superpowers/specs/2026-09-09-p2p-video-transmission-design.md`

## Global Constraints

- O MVP usa o PeerServer em `peerjs.ligmacharl.es` como canal de sinalização.
- A configuração ICE usa `stun:stun.l.google.com:19302` e não inclui TURN.
- A fonte da transmissão é `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`.
- O vídeo não é enviado para a Vercel nem para o PeerServer quando a conexão direta funciona.
- Qualquer pessoa que possua o link poderá tentar assistir.
- O app deve funcionar como frontend estático hospedado em HTTPS na Vercel.
- A verificação inclui `npm run test`, `npm run build` e teste manual em duas janelas.

### Task 1: Scaffold React/Vite com teste

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/vite-env.d.ts`
- Create: `src/main.tsx`
- Create: `src/lib/room.test.ts`

**Interfaces:**
- Produces a Vite React app with `npm run dev`, `npm run build` and `npm run test`.
- The test imports `parseWatchId` and `buildWatchUrl` from `src/lib/room.ts`, which Task 2 implements.

- [ ] **Step 1: Create the package manifest and tooling configuration**

  Add React, PeerJS and development dependencies for Vite, TypeScript and Vitest. Scripts must be:

  ```json
  {
    "scripts": {
      "dev": "vite",
      "build": "tsc -b && vite build",
      "test": "vitest run",
      "test:watch": "vitest"
    }
  }
  ```

- [ ] **Step 2: Add the test runner entry point and the first failing tests**

  Create `src/lib/room.test.ts` with tests for a valid viewer URL, a missing ID and whitespace trimming:

  ```ts
  import { describe, expect, it } from "vitest";
  import { buildWatchUrl, parseWatchId } from "./room";

  describe("room links", () => {
      it("builds a viewer link with the PeerJS id", () => {
          expect(buildWatchUrl("https://p2p.example", "/", "abc-123")).toBe(
              "https://p2p.example/?watch=abc-123",
          );
      });

      it("reads a trimmed watch id from a query string", () => {
          expect(parseWatchId("?watch=%20abc-123%20")).toBe("abc-123");
      });

      it("returns null when no watch id exists", () => {
          expect(parseWatchId("")).toBeNull();
      });
  });
  ```

- [ ] **Step 3: Run the focused test and confirm it fails**

  Run `npm run test -- src/lib/room.test.ts`.

  Expected result: FAIL because `src/lib/room.ts` does not exist yet.

- [ ] **Step 4: Add the minimal Vite entry files**

  Add `index.html`, `src/vite-env.d.ts` and `src/main.tsx`; `main.tsx` will import `App` and `src/index.css` and render into `#root`.

### Task 2: Implement route/link helpers

**Files:**
- Create: `src/lib/room.ts`
- Test: `src/lib/room.test.ts`

**Interfaces:**
- `parseWatchId(search: string): string | null` returns a nonempty trimmed `watch` query value or `null`.
- `buildWatchUrl(origin: string, pathname: string, peerId: string): string` returns a URL with the existing path and `watch` query value.

- [ ] **Step 1: Implement the two pure helpers**

  ```ts
  export function parseWatchId(search: string): string | null {
      const id = new URLSearchParams(search).get("watch")?.trim();
      return id || null;
  }

  export function buildWatchUrl(origin: string, pathname: string, peerId: string): string {
      const url = new URL(pathname || "/", origin);
      url.searchParams.set("watch", peerId);
      return url.toString();
  }
  ```

- [ ] **Step 2: Run the tests and confirm they pass**

  Run `npm run test -- src/lib/room.test.ts`.

  Expected result: 3 tests PASS.

### Task 3: Add the PeerJS transport adapter

**Files:**
- Create: `src/lib/peer.ts`
- Create: `src/types.ts`

**Interfaces:**
- `createPeer(): Peer` returns a PeerJS client configured with `peerjs.ligmacharl.es` and explicit Google STUN.
- `PeerConfig` remains local to `src/lib/peer.ts` and contains `iceServers: [{ urls: "stun:stun.l.google.com:19302" }]` and `sdpSemantics: "unified-plan"`.
- `StreamMode` is ``idle` | `starting` | `broadcasting` | `connecting` | `watching` | `error``.

- [ ] **Step 1: Define shared state types**

  Create `src/types.ts` with `StreamMode` and an `AppError` shape containing `title`, `message`, and optional `details`.

- [ ] **Step 2: Implement PeerJS creation**

  ```ts
  import Peer from "peerjs";

  export function createPeer(): Peer {
      return new Peer({
          config: {
              iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
              sdpSemantics: "unified-plan",
          },
          debug: 1,
      });
  }
  ```

- [ ] **Step 3: Verify TypeScript accepts the PeerJS adapter**

  Run `npm run build` after the React shell from Task 1 exists. Expected result: no type errors from `peer.ts` or `types.ts`.

### Task 4: Implement broadcaster and viewer flows

**Files:**
- Create: `src/App.tsx`

**Interfaces:**
- The app reads `parseWatchId(window.location.search)` once per render to choose the viewer screen.
- Broadcaster state owns the local `MediaStream`, the PeerJS `Peer`, and all incoming `MediaConnection` instances.
- Viewer state owns a PeerJS `Peer`, the outgoing `MediaConnection`, the generated silent negotiation stream, and the remote `MediaStream`.

- [ ] **Step 1: Add the broadcaster start flow**

  On “Iniciar transmissão”, call `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`; create a Peer; register `open`, `call`, `error`, `disconnected`, and `close` handlers; answer each incoming call with the local stream; then build and display the share URL from the assigned peer ID.

- [ ] **Step 2: Add broadcaster cleanup**

  On stop, close every media call, stop every local track, destroy the PeerJS peer, clear the URL and return to the idle state. Register the local video track’s `ended` event so clicking the browser’s “Stop sharing” control performs the same cleanup.

- [ ] **Step 3: Add the viewer connection flow**

  When `watch` is present, create a Peer, generate a 1x1 canvas video track plus a zero-gain `AudioContext` track, call the broadcaster with that synthetic stream, listen for `stream`, `close` and `error`, and attach the received stream to the viewer video element. Stop all synthetic tracks and close the audio context during cleanup.

- [ ] **Step 4: Add the UI actions and status mapping**

  Render a landing screen for no query, a broadcaster screen after start, and a viewer screen for `?watch=...`. Include copy-link, stop, retry and “voltar” actions. Map PeerJS errors `peer-unavailable`, `network`, `server-error`, `webrtc` and `ssl-unavailable` to messages in Portuguese.

### Task 5: Build the visual shell and documentation

**Files:**
- Create: `src/index.css`
- Modify: `src/main.tsx`
- Create: `README.md`

**Interfaces:**
- The UI must remain usable on a narrow phone viewport and a desktop window.
- The README explains local development, Vercel deployment, HTTPS, hosted PeerServer signaling, STUN limitations and manual two-browser testing.

- [ ] **Step 1: Add the responsive visual system**

  Define CSS variables for a dark navy background, cyan/green connection accents, readable cards, responsive video stage, buttons, status pills and mobile layout. Do not add a CSS framework.

- [ ] **Step 2: Add accessible video behavior**

  Set `autoPlay`, `playsInline` and `muted` on the local preview; set `autoPlay` and `playsInline` on the remote video. Use visible status text and `aria-live="polite"` for connection changes.

- [ ] **Step 3: Document Vercel deployment and limitations**

  Include `npm install`, `npm run dev`, `npm run build`, importing the repository into Vercel, and the facts that the app needs HTTPS, the PeerServer is signaling-only, STUN may fail on restrictive NATs, and the broadcaster’s upload grows with viewers.

### Task 6: Verify the delivered app

**Files:**
- Test: `src/lib/room.test.ts`
- Verify: generated `dist/`

- [ ] **Step 1: Run all automated tests**

  Run `npm run test`. Expected result: all helper tests PASS.

- [ ] **Step 2: Run the production build**

  Run `npm run build`. Expected result: TypeScript succeeds and Vite creates `dist/`.

- [ ] **Step 3: Perform manual two-browser verification**

  Run `npm run dev -- --host 0.0.0.0`, open the HTTPS deployment or localhost in two browser windows, start sharing in one, copy the generated link, open it in the other, verify remote video, stop sharing, and verify both sides show a useful terminal status.

- [ ] **Step 4: Report the known operational limitation**

  If a direct ICE connection fails, report that this build intentionally has no TURN relay and does not silently claim that every network is supported.
