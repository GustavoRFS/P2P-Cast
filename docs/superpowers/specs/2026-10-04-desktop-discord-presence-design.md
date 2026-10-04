# P2P-Cast desktop, login Discord e presença — design

## Objetivo

Adicionar ao P2P-Cast um cliente desktop que reutiliza a interface React e o protocolo PeerJS já existentes. O login Discord é opcional para transmitir; usuários autorizados pela whitelist podem aparecer como ao vivo para os demais usuários autorizados. A captura de uma janela envia somente o aplicativo escolhido, incluindo áudio isolado desse processo no Windows.

## Limites e compatibilidade

- PeerJS Cloud continua responsável pela sinalização WebRTC existente. A mídia continua ponto a ponto; o novo backend não transporta mídia nem substitui o formato de sala atual.
- A aplicação desktop será Electron para reutilizar Chromium, React, PeerJS e `getDisplayMedia`.
- A lista de janelas vem de `desktopCapturer` e a solicitação de captura seleciona exatamente a fonte escolhida entre as fontes expostas pelo sistema. Wayland/PipeWire pode expor somente a tela inteira. O áudio de loopback global do Electron nunca será usado.
- Áudio isolado por processo será fornecido no Windows por um utilitário C++ com WASAPI Application Loopback. A captura de áudio fica disponível a partir do Windows 10 build 20348. Em macOS e Linux, o áudio do aplicativo fica desativado até haver um capturador nativo isolado para a plataforma. A seleção de vídeo segue as fontes de janela expostas pelo sistema; no Linux com Wayland/PipeWire pode haver somente a tela inteira. Microfone e câmera continuam seguindo as opções existentes.
- A aplicação web e Android permanecem no protocolo e fluxo atuais. Nenhum dos arquivos Android atualmente modificados pelo usuário será alterado.

## Experiência desktop

- A tela inicial lista janelas abertas. O usuário escolhe uma janela/aplicativo, configura resolução/FPS/bitrate e inicia a transmissão.
- Em Windows, a opção de áudio corresponde ao áudio do processo dono da janela selecionada, incluindo processos filhos, e não ao mix do sistema. Falha ao iniciar o capturador mostra erro explícito; o app nunca troca silenciosamente para áudio global.
- Em outras plataformas, a captura de janela continua disponível e a opção de áudio do aplicativo informa que não está suportada. A transmissão pode iniciar sem esse áudio.
- O fluxo de login abre a página oficial do Discord no navegador do sistema. Um protocolo profundo `p2pcast://` devolve um código de uso único ao Electron, que o troca por um JWT válido por sete dias e guarda o token via `safeStorage`.
- Pessoas sem sessão podem iniciar e assistir transmissões pelo fluxo PeerJS atual. Sem login, não publicam nem recebem presença.
- Usuários da whitelist veem os usuários autorizados atualmente ao vivo. Clicar em um item abre a transmissão pelo peer ID, usando a tela de espectador já existente.

## Backend Elysia

- Executa com Bun e Elysia. A whitelist local é `backend/whitelist.json`, contendo IDs numéricos de usuário Discord; esse arquivo e o `.env` não entram no controle de versão.
- `GET /auth/discord` recebe um desafio SHA-256 criado pelo desktop, gera e registra o `state` OAuth do servidor e inicia o fluxo de authorization code com escopo `identify`. O desafio limita a troca do código ao desktop que iniciou o login; o fluxo Discord usa somente parâmetros OAuth documentados (`state`, `code`, `redirect_uri`), sem depender de suporte PKCE do Discord. O callback verifica state, troca o code com Discord, consulta `/users/@me` e recusa qualquer ID ausente da whitelist.
- Após autenticar, o callback cria um código temporário de uso único e redireciona a `p2pcast://auth`. O endpoint de troca exige o verificador do desktop correspondente antes de emitir um JWT assinado pelo servidor. O verificador fica cifrado em `safeStorage` por até dez minutos para permitir retorno ao app mesmo se ele for iniciado de novo. O segredo OAuth e o segredo JWT ficam em variáveis de ambiente.
- `GET /api/me` permite carregar a conta salva. `WS /api/presence` exige autenticação no primeiro frame, confirma a autenticação em um frame separado e então envia a lista atual. Mensagens subsequentes anunciam peer ID ao iniciar ou encerrar uma live. O backend mantém apenas presenças em memória, remove-as no fechamento do socket e envia atualizações somente aos sockets autenticados.
- Cada presença expõe ID Discord, nome de exibição, avatar, peer ID e rótulo opcional de atividade. Nenhum SDP, ICE, vídeo, áudio, endereço IP ou histórico de live é persistido pelo backend.

## Integração e componentes

- `desktop/src/main.cjs`: janela Electron segura, custom protocol para recursos locais, deep link de autenticação, fontes de captura, handler de `getDisplayMedia`, IPC e processo WASAPI.
- `desktop/src/preload.cjs`: API pequena e validada para janela, autenticação e captura de áudio; renderer permanece sem Node integration.
- `desktop/src/renderer.d.ts`: contrato de tipos do preload usado pelo React.
- `desktop/native/windows`: helper WASAPI que recebe o identificador da janela, resolve o processo proprietário, captura só esse processo e sua árvore, e emite formato mais PCM float para o Electron.
- `web/src/lib/desktop.ts`: lista de janelas, captura de vídeo e montagem da faixa de áudio isolado.
- `web/src/lib/desktop-account.ts`: sessão Discord, autenticação e socket de presença.
- `web/src/App.tsx` e `web/src/index.css`: seletor de janela, conta Discord e lista de usuários ao vivo na home desktop; inicialização/parada da presença com o ciclo da transmissão.
- `backend/src`: OAuth, validação da whitelist, JWT e WebSocket de presença.

## Segurança e falhas

- Electron usa `contextIsolation`, `sandbox`, `nodeIntegration: false`, Content Security Policy e handlers IPC com validação de argumentos. Navegação externa abre apenas HTTPS do Discord/backend configurado.
- A interface empacotada usa o origin seguro `p2pcast-app://desktop`; Elysia permite CORS somente para os origins configurados, e o WebSocket valida o origin antes da autenticação.
- OAuth verifica `state`, vincula cada código de uso único ao desafio enviado pelo desktop, expira códigos pendentes rapidamente e não coloca o verificador em um deep link.
- A whitelist é lida no callback de login; remover um usuário impede logins futuros. JWT expira em sete dias. Token persistido é protegido por `safeStorage` quando o sistema operacional oferece armazenamento seguro.
- Conexão de presença exige autenticação em até cinco segundos. Peer ID e atividade têm limite de tamanho; uma conexão pode publicar somente a identidade derivada do token.
- Se o backend estiver indisponível ou a whitelist não permitir login, transmissão PeerJS anônima continua funcionando. Presença se reconecta com atraso crescente e sai ao parar ou fechar o app.
- Se áudio WASAPI não puder ser iniciado, a live não incluirá áudio de outro processo. O usuário pode desligar o áudio do aplicativo e transmitir somente vídeo.

## Configuração e entrega

- `backend/.env.example` documenta `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `JWT_SECRET`, `PUBLIC_URL` e `PORT`.
- `backend/whitelist.example.json` mostra o formato; `backend/whitelist.json` é um arquivo local ignorado pelo Git.
- `desktop/config.example.json` mostra `backendUrl` e `webUrl`, usados pelo app empacotado para login/presença e para gerar links compatíveis com o espectador web atual.
- A raiz do repositório documenta instalação e execução web, backend, desktop e build Windows, incluindo o build CMake do helper WASAPI.

## Critérios de aceite

1. O desktop inicia o app existente e continua aceitando links PeerJS de espectadores web/Android.
2. A seleção de uma janela captura somente essa janela; encerrar a transmissão encerra faixas e processos nativos.
3. No Windows com helper compilado, o áudio enviado contém somente áudio do processo selecionado e seus filhos. Nenhum modo de fallback captura o sistema inteiro.
4. Discord não autorizado recebe recusa e não pode abrir socket de presença.
5. Discord autorizado pode entrar/sair e vê ao vivo/outro peer desaparecer em tempo real.
6. Um usuário anônimo pode transmitir e assistir sem a API de autenticação estar disponível.
7. WebRTC, sala, câmera, chat e espectador atuais preservam o comportamento existente.

## Verificação prevista

Não serão adicionados nem executados testes automatizados neste trabalho. A entrega será conferida por build TypeScript/Vite, build TypeScript do backend e empacotamento do Electron disponível no ambiente. O utilitário Windows requer Windows SDK e será documentado para compilação Windows caso o ambiente de desenvolvimento não seja Windows.
