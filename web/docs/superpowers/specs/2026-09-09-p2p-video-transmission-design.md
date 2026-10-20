# P2P Cast — design do MVP

## Objetivo

Criar uma aplicação web React que permita a uma pessoa iniciar uma transmissão de vídeo com um clique, copiar um link e receber espectadores diretamente por WebRTC. O vídeo deve trafegar entre os navegadores, sem servidor de mídia ou backend de aplicação próprio.

## Limite técnico assumido

O MVP usará o PeerServer em `peerjs.ligmacharl.es` como canal de sinalização. Esse serviço troca IDs, ofertas, respostas e candidatos ICE, mas não deve transportar o vídeo quando uma rota P2P direta puder ser estabelecida. A configuração de ICE usará `stun:stun.l.google.com:19302`.

STUN não garante conexão em todas as redes. Sem TURN, algumas combinações de NAT/firewall falharão e a interface deverá explicar que a rede não permitiu uma conexão direta. Adicionar TURN fica fora do MVP.

## Fluxo principal

1. O transmissor clica em “Iniciar transmissão”.
2. O navegador solicita permissão para compartilhar tela e áudio via `getDisplayMedia`.
3. O app cria um `Peer` e espera o ID ser registrado no PeerServer em `peerjs.ligmacharl.es`.
4. O app mostra uma URL com o ID do transmissor e oferece cópia para a área de transferência.
5. Um espectador abre a URL, o app cria seu `Peer` e chama o ID do transmissor com uma faixa de vídeo preta e uma faixa de áudio silenciosa geradas localmente, sem pedir acesso à câmera ou ao microfone. Isso atende à exigência atual do método `peer.call` e permite que o transmissor devolva a mídia real.
6. O transmissor atende a chamada e envia seu `MediaStream`.
7. O espectador mostra o stream em um elemento `<video>`.
8. Encerrar a captura encerra a chamada, destrói o peer e retorna à tela inicial.

Cada espectador usa uma conexão separada com o transmissor. Portanto, o upload do transmissor cresce com o número de espectadores; escalabilidade para muitos espectadores exigiria uma arquitetura SFU e não faz parte deste MVP.

## Estrutura

- `src/App.tsx`: roteamento simples por query string, telas e orquestração do fluxo.
- `src/lib/peer.ts`: criação do PeerJS com o PeerServer hospedado e configuração STUN.
- `src/types.ts`: estados e tipos compartilhados.
- `src/index.css`: interface responsiva e estados visuais.

## Interface

- Tela inicial com explicação curta e botão “Iniciar transmissão”.
- Tela do transmissor com preview, status, link compartilhável, botão de copiar e botão de encerrar.
- Tela do espectador com status de conexão, vídeo remoto e opção de sair.
- Mensagens claras para permissão recusada, link inválido, desconexão e falha ICE.

## Segurança e privacidade

- O app não terá contas nem controle de acesso no MVP.
- Qualquer pessoa que possua o link poderá tentar entrar na transmissão.
- O viewer não compartilha mídia pessoal; suas faixas de negociação são artificiais, silenciosas e descartadas ao sair.
- O vídeo usará a conexão WebRTC criptografada pelo navegador, mas a sinalização ainda passará pelo PeerServer.
- `getDisplayMedia` normalmente exige HTTPS, exceto em `localhost`.

## Verificação

- TypeScript deve compilar sem erros.
- O build de produção deve concluir com `npm run build`.
- Teste manual em duas janelas/navegadores: iniciar, copiar link, entrar como espectador, confirmar vídeo e encerrar.
- Teste manual de cancelamento de permissão e encerramento da captura.

## Fora do escopo

- Backend próprio, banco de dados, autenticação, chat, gravação, TURN, múltiplos transmissores, moderação e distribuição via CDN.
