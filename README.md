# p2pcast

Uma ferramenta leve para compartilhar a tela com amigos durante uma partida ou conversa. A mídia usa WebRTC diretamente entre os navegadores; o PeerJS Cloud é usado somente para a sinalização inicial.

## Rodar localmente

Requisitos: Node.js 20+ e npm.

```bash
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite. localhost é considerado um contexto seguro pelos navegadores para o compartilhamento de tela.

## Build

```bash
npm run test
npm run build
```

## Publicar na Vercel

1. Envie este repositório para o GitHub.
2. Importe o repositório na Vercel.
3. Use npm run build como comando de build.
4. Use dist como diretório de saída, se a Vercel pedir essa configuração.

A URL da Vercel usa HTTPS, então getDisplayMedia poderá solicitar o compartilhamento de tela. Não é necessário criar uma Vercel Function, banco de dados ou servidor de vídeo.

## Como funciona

- O transmissor clica em **Iniciar transmissão** e escolhe uma tela ou janela.
- O app cria um ID temporário no PeerJS Cloud e gera um link.
- O espectador abre o link e cria uma conexão WebRTC com o transmissor.
- A imagem e o áudio seguem diretamente entre os navegadores quando a rede permite.

O PeerJS Cloud ainda participa da sinalização. O Google STUN ajuda a descobrir uma rota direta, mas algumas redes restritivas exigiriam TURN e não são suportadas por esta primeira versão.

## Limitações intencionais

- Qualquer pessoa com o link pode tentar entrar.
- O link deixa de funcionar quando o transmissor encerra a aba ou a transmissão.
- Cada espectador abre uma conexão separada com o transmissor, então o upload e o processamento crescem conforme entram pessoas.
- O projeto é voltado para pequenos grupos de amigos, não para streaming profissional.
- Alguns navegadores bloqueiam áudio automático; nesse caso, use o botão **Ativar áudio**.
