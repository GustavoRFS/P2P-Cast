# P2P-Cast

O projeto mantém três clientes compatíveis com o mesmo protocolo PeerJS:

- `web/`: React/Vite para transmitir e assistir pelo navegador.
- `android/`: aplicativo Android atual.
- `app-react-native/`: cliente Expo/React Native Android separado, com módulo Kotlin para captura de tela/câmera, vídeo WebRTC, PiP e EAS Update. Consulte [o README do app](app-react-native/README.md) para desenvolvimento, builds e publicação OTA.
- `desktop/`: cliente Electron que reaproveita a interface React. Ele mantém os mesmos links PeerJS, adiciona login Discord opcional e mostra usuários autorizados ao vivo.
- `backend/`: serviço Bun/Elysia para OAuth Discord, whitelist JSON e presença em tempo real. Ele não recebe vídeo nem áudio.

## Backend e whitelist Discord

Requisitos: Bun, Node.js para a compilação TypeScript e npm.

```sh
cd backend
bun install
cp .env.example .env
cp whitelist.example.json whitelist.json
bun run dev
```

Edite `backend/.env` e configure:

- `PUBLIC_URL`: origin público do backend, sem barra final.
- `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`: credenciais de uma aplicação criada no Discord Developer Portal.
- `DISCORD_REDIRECT_URI`: URL pública `${PUBLIC_URL}/auth/discord/callback`, também cadastrada como redirect URI no Discord.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `NODE_ENV=development` habilita valores locais durante desenvolvimento. Em produção, defina `NODE_ENV=production` e configure todos os segredos; fora do modo de desenvolvimento o backend falha ao iniciar se faltar qualquer um deles.
- `APP_ORIGINS`: origins exatos dos clientes desktop. Inclua `p2pcast-app://desktop` para Electron e `http://tauri.localhost` (Windows) e `tauri://localhost` (macOS/Linux) para Tauri. Durante desenvolvimento, inclua também `http://127.0.0.1:5173` e `http://localhost:5173`.

`whitelist.example.json` mostra o formato. Em `whitelist.json`, mantenha apenas strings com os IDs Discord autorizados. O arquivo real é ignorado pelo Git. Se ele não existir, nenhum usuário pode entrar. O serviço consulta a whitelist em cada login, e qualquer edição passa a valer no próximo login.

Para desenvolvimento local, use `PUBLIC_URL=http://localhost:3001` e registre exatamente `http://localhost:3001/auth/discord/callback` na aplicação Discord, se permitido pela configuração OAuth. Para disponibilizar login a outros computadores, publique o backend atrás de HTTPS e registre o redirect URI HTTPS correspondente. O OAuth exige que `DISCORD_REDIRECT_URI` corresponda ao valor usado no login.

Endpoints principais:

- `GET /auth/discord`: inicia login Discord.
- `GET /auth/discord/callback`: confere state, consulta a identidade e a whitelist.
- `POST /auth/exchange`: troca um código de uso único por JWT.
- `GET /api/me`: valida a sessão atual.
- `WS /api/presence`: recebe peer IDs e publica somente usuários ao vivo.
- `GET /health`: status do serviço.

Presença existe somente enquanto a conexão WebSocket permanece aberta. O backend não persiste contas, histórico, endereços IP, sinalização WebRTC nem mídia.

## Web

```sh
cd web
npm ci
npm run dev
```

Para um build web: `npm run build`. Os clientes usam `https://peerjs.ligmacharl.es/peerjs` para sinalização segura e WebRTC direto para vídeo/áudio. Sem TURN, algumas redes restritivas podem impedir uma conexão P2P direta.

## Desktop

```sh
cd desktop
npm install
cp config.example.json config.json
npm run dev
```

Durante desenvolvimento, `desktop/config.json` configura o backend e a URL do cliente web. `backendUrl` deve ser o backend acima; `webUrl` deve ser a URL HTTPS onde o app web está publicado. Essa URL é usada nos links que o desktop compartilha, para que espectadores web e Android continuem abrindo a sala pelo fluxo atual. Também é possível definir `P2PCAST_BACKEND_URL`, `P2PCAST_WEB_URL` ou `P2PCAST_CONFIG_PATH` no ambiente.

No app empacotado, coloque `config.json` na pasta `resources` ao lado do executável dentro da pasta de recursos do Electron, ou use `P2PCAST_CONFIG_PATH`. Copie o formato de `desktop/config.example.json` e troque os dois endereços. O app usa o protocolo seguro `p2pcast-app://desktop` para os arquivos locais; `p2pcast://` recebe o retorno OAuth do Electron e `p2pcast-tauri://` o do Tauri. O backend prende o host ao `state` OAuth; logins antigos sem identificação de host continuam usando o retorno Electron.

O login Discord é opcional para iniciar uma transmissão. Contas fora da whitelist são recusadas, e usuários anônimos ainda podem transmitir e assistir por link PeerJS. Com login, o app mostra as contas autorizadas que estão transmitindo e permite abrir a live pelo peer ID.

## Captura de um aplicativo

O seletor desktop lista janelas abertas; a solicitação de captura aponta somente para a janela escolhida. O áudio de loopback global do Electron não é usado.

No macOS, permita gravação de tela nas configurações de privacidade do sistema. No Linux com Wayland/PipeWire, o sistema pode disponibilizar somente a tela inteira em vez de janelas individuais; o seletor mostra as fontes que o sistema expõe.

O áudio isolado por processo está disponível no Windows 10 build 20348 ou superior, com o helper WASAPI compilado. Em um prompt com Visual Studio C++ Build Tools, Windows SDK e CMake:

```sh
cd desktop
npm run build:audio:windows
npm run dev
```

Para gerar o instalador Windows, use `npm run build:win`. Para gerar um diretório empacotado no sistema atual, use `npm run build`.

O helper identifica o processo dono da janela e captura esse processo e seus filhos. Por exemplo, ao selecionar CS2, sons de Discord e Spotify não entram no áudio transmitido. Em macOS e Linux, o desktop transmite a janela selecionada sem áudio do aplicativo até haver uma captura nativa isolada para essas plataformas. No Linux, a seleção de janela também depende das fontes permitidas por X11 ou PipeWire. Se o helper Windows não iniciar, o app mostra o erro e não troca para áudio global. Desligar a opção permite continuar só com vídeo.

## Desktop Tauri para comparação

O host Tauri em `desktop-tauri/` usa a mesma aplicação React em `web/`, o mesmo backend, login Discord/PKCE, presença, PeerJS e links de sala. Para compilação nativa, instale Rust stable e as dependências desktop do Tauri para o sistema usado para compilar (WebView2/MSVC no Windows, Xcode no macOS ou WebKitGTK/GTK no Linux).

```sh
cd web
npm ci
cd ../desktop-tauri
npm install
cp config.example.json config.json
npm run dev
```

Configure `backendUrl` e `webUrl` em `desktop-tauri/config.json` durante o desenvolvimento. No app empacotado, use `P2PCAST_CONFIG_PATH` ou crie `config.json` na pasta de configuração do P2P-Cast Tauri do sistema operacional. `P2PCAST_BACKEND_URL` e `P2PCAST_WEB_URL` também podem sobrescrever os valores. No primeiro uso, o Tauri grava a sessão e o verifier PKCE no gerenciador de credenciais do sistema operacional. Em Linux, é necessário ter um Secret Service disponível.

Para gerar um instalador no sistema atual, use `npm run build`; para escolher um formato, use `npm run build:windows`, `npm run build:macos` ou `npm run build:linux` dentro de `desktop-tauri/`. O Tauri usa o WebView do sistema operacional (WebView2 no Windows, WKWebView no macOS e WebKitGTK no Linux); por isso, compare tanto o tamanho do instalador quanto o tamanho instalado. O bootstrapper do WebView2 pode instalar um runtime externo no Windows.

O seletor nativo do Tauri pede que a pessoa escolha uma janela. A aplicação confere que o WebView retornou uma janela e encerra a captura se o sistema devolver a tela inteira. O áudio da janela e o áudio do sistema ficam desligados no Tauri; assim a transmissão não leva sons do Discord, Spotify ou outros aplicativos. O microfone continua opcional. A versão Tauri ainda não envia o áudio do jogo. Para desempenho, rode Electron e Tauri no mesmo computador com a mesma resolução, FPS, bitrate, conta e número de espectadores, e compare CPU e memória durante a transmissão. Como o Tauri não inclui áudio isolado, a medição de mídia não é idêntica.

## Compatibilidade do protocolo

O servidor PeerJS em `peerjs.ligmacharl.es/peerjs` faz a sinalização inicial, o link de sala continua contendo o peer ID e os streams continuam ponto a ponto. O backend Elysia não substitui PeerJS e não participa do transporte de mídia. Web, Android, React Native e desktop podem continuar assistindo uns aos outros quando compartilham o mesmo peer ID/link e uma rota WebRTC direta é possível.
