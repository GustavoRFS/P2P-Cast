# P2P-Cast

O projeto mantém três clientes compatíveis com o mesmo protocolo PeerJS:

- `web/`: React/Vite para transmitir e assistir pelo navegador.
- `android/`: aplicativo Android atual.
- `desktop/`: cliente Electron que reaproveita a interface React. Ele mantém os mesmos links PeerJS, adiciona login Discord opcional e mostra usuários autorizados ao vivo.
- `backend/`: serviço Bun/Elysia para OAuth Discord, validação de membros de um servidor e presença em tempo real. Ele não recebe vídeo nem áudio.

## Backend e acesso pelo servidor Discord

Requisitos: Bun, Node.js para a compilação TypeScript e npm.

```sh
cd backend
bun install
cp .env.example .env
bun run dev
```

Edite `backend/.env` e configure:

- `PUBLIC_URL`: origin público do backend, sem barra final.
- `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`: credenciais de uma aplicação criada no Discord Developer Portal.
- `DISCORD_GUILD_ID`: ID do servidor cujos membros podem entrar no P2P-Cast. O backend pede o escopo OAuth `guilds.members.read` e consulta somente a associação a esse servidor; não é necessário instalar um bot.
- `DISCORD_REDIRECT_URI`: URL pública `${PUBLIC_URL}/auth/discord/callback`, também cadastrada como redirect URI no Discord.
- `JWT_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `NODE_ENV=development` habilita valores locais durante desenvolvimento. Em produção, defina `NODE_ENV=production` e configure todos os segredos; fora do modo de desenvolvimento o backend falha ao iniciar se faltar qualquer um deles.
- `APP_ORIGINS`: origins exatos dos clientes desktop. Inclua `p2pcast-app://desktop` para Electron e `http://tauri.localhost` (Windows) e `tauri://localhost` (macOS/Linux) para Tauri. Durante desenvolvimento, inclua também `http://127.0.0.1:5173` e `http://localhost:5173`.

Para desenvolvimento local, use `PUBLIC_URL=http://localhost:3001` e registre exatamente `http://localhost:3001/auth/discord/callback` na aplicação Discord, se permitido pela configuração OAuth. Para disponibilizar login a outros computadores, publique o backend atrás de HTTPS e registre o redirect URI HTTPS correspondente. O OAuth exige que `DISCORD_REDIRECT_URI` corresponda ao valor usado no login.

Endpoints principais:

- `GET /auth/discord`: inicia login Discord.
- `GET /auth/discord/callback`: confere state, valida a participação no servidor e consulta a identidade.
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

Para um build web: `npm run build`. O app web usa `peerjs.ligmacharl.es` para sinalização e WebRTC direto para vídeo/áudio. Sem TURN, algumas redes restritivas podem impedir uma conexão P2P direta.

## Desktop

```sh
cd desktop
npm install
cp config.example.json config.json
npm run dev
```

Durante desenvolvimento, `desktop/config.json` configura o backend e a URL do cliente web. `backendUrl` deve ser o backend acima; `webUrl` deve ser a URL HTTPS onde o app web está publicado. Essa URL é usada nos links que o desktop compartilha, para que espectadores web e Android continuem abrindo a sala pelo fluxo atual. Também é possível definir `P2PCAST_BACKEND_URL`, `P2PCAST_WEB_URL` ou `P2PCAST_CONFIG_PATH` no ambiente.

No app empacotado, coloque `config.json` na pasta `resources` ao lado do executável dentro da pasta de recursos do Electron, ou use `P2PCAST_CONFIG_PATH`. Copie o formato de `desktop/config.example.json` e troque os dois endereços. O app usa o protocolo seguro `p2pcast-app://desktop` para os arquivos locais; `p2pcast://` recebe o retorno OAuth do Electron e `p2pcast-tauri://` o do Tauri. O backend prende o host ao `state` OAuth; logins antigos sem identificação de host continuam usando o retorno Electron.

O login Discord é opcional para iniciar uma transmissão. Contas que não pertencem ao servidor configurado são recusadas no login, e usuários anônimos ainda podem transmitir e assistir por link PeerJS. Com login, o app mostra membros autorizados que estão transmitindo e permite abrir a live pelo peer ID. A associação é verificada no login; sessões existentes continuam válidas até expirarem.

No desktop Electron para Windows, uma nova transmissão de outro usuário autorizado gera um aviso dentro do app e uma notificação do Windows. Ao clicar no aviso, o P2P-Cast abre a transmissão. Minimizar a janela esconde o app na bandeja; use o ícone para restaurar a janela ou sair. Os avisos exigem login Discord e conexão ativa com o backend de presença.

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

O Tauri lista janelas e monitores e oferece dois métodos nos perfis de atalho: captura direta por Windows Graphics Capture (WGC), que usa o alvo salvo, e o seletor do Windows, que pede uma escolha a cada início. A captura WGC está disponível quando o helper nativo foi compilado e incluído no pacote; requer Windows 10 versão 1903 ou posterior. Os perfis guardam o alvo de vídeo, o programa de áudio e o atalho global; o áudio usa o helper WASAPI e nunca usa loopback global.

Os perfis de atalho podem ser editados, e cada card tem um botão "Iniciar live" que faz o mesmo que o atalho. O atalho pode ser uma tecla sozinha (F9) ou uma combinação (Ctrl+Shift+F9); uma tecla de digitação sozinha (uma letra, Espaço, Enter) ganha um aviso, porque fica presa ao app em todo o Windows. Com a live no ar, o atalho só age no segundo aperto em até 3 s; o primeiro mostra um aviso dizendo o que o próximo fará:

- **Atalho do perfil atual:** encerra a live.
- **Atalho de outro perfil:** troca a captura e as configurações sem encerrar. No envio nativo, o capturador novo começa antes de o antigo parar, e quem assiste recebe um quadro-chave no tamanho novo, sem reconectar. No caminho pelo WebView, as faixas de cada conexão são substituídas.

Iniciar pelo atalho, encerrar, trocar e uma parada inesperada geram avisos só para quem transmite, na janela de notificação e no canto escolhido no app. Os outros usuários continuam recebendo aviso só quando uma live começa.

### Envio nativo

Nos perfis de captura direta (WGC), o próprio app envia a live desde a 0.4, sem passar pelo WebView: `desktop-tauri/native-broadcast` recebe os quadros do helper WGC e o PCM do helper WASAPI, codifica uma vez só e serve cada espectador com sua própria conexão WebRTC, falando o mesmo protocolo do PeerJS. Os espectadores (web, desktop, Android) não mudam.

- **Vídeo:** H.264 Constrained Baseline. Usa o codificador da GPU que o Media Foundation encontrar (NVENC, AMD, Quick Sync) e cai para o openh264 (CPU) se não houver um ou se ele falhar. Teto de 60 fps; a resolução do perfil limita o tamanho; sem bitrate no perfil, ele é calculado pela resolução e pelo fps. Com a tela parada, o último quadro é reenviado uma vez por segundo, e cada espectador que entra pede um quadro-chave.
- **Áudio:** Opus estéreo a 128 kbps, em quadros de 20 ms.
- **RTP:** o timestamp de cada quadro vem da hora da captura, então uma pausa da imagem não vira atraso no player de quem assiste.
- **Chat:** BinaryPack para os navegadores e JSON para o app Android, como o PeerJS.
- **Na tela da live:** no lugar da prévia aparece o codificador em uso, a resolução, o fps e a taxa.
- **Volta ao caminho antigo:** se o envio nativo não iniciar, o app usa o pipeline do WebView. Para forçar o caminho antigo, rode `localStorage.setItem("p2pcast.native-broadcast", "off")` no console do app.

No `ligma`, `cargo test` em `desktop-tauri/native-broadcast` roda os testes do crate, e `cargo run --release --example synthetic` abre uma live sintética (barras coloridas e um tom de 440 Hz, openh264) que qualquer espectador pode assistir.

Antes de empacotar no Windows, compile os dois helpers nativos em `desktop/` com `npm run build:audio:windows`. O comando gera e copia `desktop/resources/p2pcast-process-audio.exe` e `desktop/resources/p2pcast-wgc-capture.exe`; o pacote Tauri inclui ambos. A integração WGC e o build de frontend passam nas verificações disponíveis aqui, mas a compilação dos helpers e a captura/teardown precisam de validação em uma máquina Windows. Para comparar desempenho, rode Electron e Tauri no mesmo computador com resolução, FPS, bitrate, conta e número de espectadores iguais.

### Atualizações do desktop

O app instalado se atualiza pelo `tauri-plugin-updater`, só em dois momentos: ao iniciar e pelo item "Verificar atualizações" do tray. Ele lê `https://github.com/GustavoRFS/P2P-Cast/releases/latest/download/latest.json`, baixa o instalador, confere a assinatura e nunca instala durante uma transmissão. Ao iniciar, instala se o app estiver parado no tray; pelo tray, instala na hora. O que precisar esperar aparece como "Atualizar para a X" no app e no tray, e as respostas da verificação manual aparecem no canto escolhido para os avisos de live. O instalador NSIS roda em modo passivo e reabre o app.

Para publicar uma versão, suba o `version` em `desktop-tauri/src-tauri/tauri.conf.json`, faça commit e push, e rode `npm run release -- --notes "O que mudou"` dentro de `desktop-tauri/` (com `--draft` para revisar antes). O script gera o instalador assinado, monta o `latest.json` e cria a release `desktop-v<versão>` marcada como latest, que é a que o feed resolve. A chave privada fica em `~/.tauri/p2p-cast-updater.key` (ou em `TAURI_SIGNING_PRIVATE_KEY`) e deve ter backup: sem ela, os apps instalados não aceitam mais atualizações. A chave pública está em `plugins.updater.pubkey`.

### Máquina de build

Os builds de release rodam na máquina Linux `ssh ligma`, não no desktop Windows. `scripts/setup-linux-build-machine.sh` instala tudo sem `sudo` (EAS CLI, Rust com `cargo-xwin` para gerar o instalador do Windows a partir do Linux, `makensis`, emulador Android) e grava o ambiente em `~/.p2pcast-build-env`. Lá: `source ~/.p2pcast-build-env`, depois `npm run release -- --no-publish` em `desktop-tauri/` e `npm run release:android -- --no-publish` em `app-react-native/`; os arquivos assinados são publicados com `gh release create` de uma máquina com acesso ao GitHub. As chaves de assinatura não são criadas pelo script: copie `~/.android/p2pcast-release.{jks,properties}` e `~/.tauri/p2p-cast-updater.key`.

## Compatibilidade do protocolo

O PeerServer em `peerjs.ligmacharl.es` faz a sinalização inicial, o link de sala continua contendo o peer ID e os streams continuam ponto a ponto. O backend Elysia não substitui PeerJS e não participa do transporte de mídia. Web, Android e desktop podem continuar assistindo uns aos outros quando compartilham o mesmo peer ID/link e uma rota WebRTC direta é possível.
