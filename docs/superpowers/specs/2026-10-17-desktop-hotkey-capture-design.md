# Atalhos de transmissão e captura Tauri — design

## Objetivo

Permitir que usuários criem perfis para iniciar uma transmissão por atalho global no Electron e no Tauri para Windows. Um perfil seleciona um programa em execução ou um monitor, configura a tecla de atalho e sempre envia áudio isolado do programa escolhido, nunca o áudio global do computador.

No Tauri, cada perfil de tela escolhe entre dois métodos: abrir o seletor nativo de compartilhamento do Windows ou capturar diretamente o destino cadastrado. O segundo método inicia sem um segundo seletor.

## Escopo e compatibilidade

- A primeira entrega cobre Windows nos dois hosts desktop, com o app em execução, inclusive quando sua janela estiver minimizada/oculta na bandeja.
- Os perfis são compartilhados pela interface React e persistidos localmente por instalação desktop. Eles não são sincronizados com o servidor.
- Atalhos são globais, únicos entre perfis do mesmo app e registrados pelo host nativo. Um atalho em conflito ou não suportado é mostrado como erro e não substitui silenciosamente outro perfil.
- O seletor do Windows pode iniciar a transmissão de uma janela ou de um monitor. A captura direta Tauri lista janelas de aplicativo abertas e monitores conectados.
- Câmera, microfone, espectador, protocolo PeerJS, login e presença existentes mantêm os fluxos atuais. Esta entrega não altera backend, Android ou servidor.

## Experiência e modelo dos perfis

Cada perfil contém identificador estável, nome, destino de vídeo (`janela` ou `monitor`), identificador nativo do destino quando ele for persistente durante a sessão, método Tauri (`seletor do Windows` ou `captura direta`), programa fonte do áudio, atalho e as configurações de transmissão existentes (resolução, FPS, bitrate e cursor). Um perfil de janela usa por padrão o mesmo programa como fonte de áudio. Um perfil de monitor exige um programa fonte de áudio escolhido pelo usuário.

A área de atalhos permite adicionar, editar, remover, atualizar a lista de programas/monitores e gravar a combinação de teclas. A lista de janelas vem dos processos em execução no momento do cadastro; monitores aparecem como destinos extras. O perfil indisponível porque a janela fechou ou o monitor desconectou não inicia a transmissão e gera notificação local. Uma combinação aceita inicia o perfil cadastrado; se já houver transmissão, o app informa que a transmissão está ativa em vez de abrir uma segunda captura.

O método de captura do Tauri é uma opção visível no perfil. No modo seletor, o Windows decide qual destino de vídeo será compartilhado; o programa de áudio permanece explícito no perfil para que nunca seja usado áudio global. A interface deixa claro que o vídeo pode não corresponder ao programa de áudio se o usuário escolher um destino diferente no seletor.

## Arquitetura

- O React mantém o modelo e a persistência dos perfis, lista as fontes usando a ponte desktop e entrega mudanças de registro de atalhos ao host.
- Electron registra e remove combinações pela API global de atalhos existente no processo principal. A ativação envia um evento tipado ao renderer para iniciar o fluxo de transmissão existente com o perfil.
- Tauri registra e remove combinações por plugin global de atalhos. A ativação emite um evento tipado para a janela React. A janela precisa continuar viva em segundo plano; minimizar/ocultar a janela não encerra o processo.
- O método `seletor do Windows` mantém `getDisplayMedia`, habilitando janela e monitor. A faixa de vídeo resultante continua no pipeline WebRTC atual.
- O método `captura direta` usa `Windows.Graphics.Capture` para criar itens a partir do HWND da janela ou HMONITOR escolhido e inicia uma sessão/pooled frames. Um adaptador do host entrega vídeo como uma fonte compatível com o fluxo de publicação WebRTC atual. A implementação não deve serializar quadros BGRA integrais em eventos Tauri por quadro; usar uma ponte de vídeo nativa de baixa cópia ou mecanismo equivalente adequado a captura contínua.
- O áudio é capturado por processo com WASAPI Application Loopback no Windows, usando o processo proprietário da janela escolhida ou o programa fonte escolhido no perfil de monitor. As amostras PCM são integradas à trilha de áudio publicada, seguindo o contrato existente de captura de áudio. Não existe fallback para áudio de sistema.
- A seleção pelo seletor de Windows e a captura direta são opções por perfil Tauri; Electron mantém o seletor por lista de janelas que já oferece.

## Falhas, ciclo de vida e segurança

- Recusar o seletor do Windows, fechar a janela de destino, desconectar um monitor, falhar no capturador WASAPI ou perder suporte à API nativa cancela a inicialização e mostra mensagem clara. Não iniciar silenciosamente vídeo sem o áudio do perfil.
- Parar a transmissão, encerrar o processo ou fechar a janela do destino remove atalhos temporários de captura, fecha sessão/frame pool, encerra captura de áudio, solta faixas e listeners. Os atalhos de perfis permanecem registrados enquanto o app estiver aberto.
- Os identificadores de janela/monitor são validados no host e não são tratados como caminhos executáveis ou comandos. O app não executa o binário selecionado; ele apenas identifica o processo já em execução para captura.
- A janela principal pode ficar minimizada ou oculta, mas o encerramento completo do app desregistra os atalhos.

## Critérios de aceite

1. O usuário cria, edita e remove perfis com destino, método Tauri, fonte de áudio e combinação de teclas; os dados sobrevivem ao reinício do app.
2. Uma combinação global inicia o perfil correspondente no Electron e no Tauri enquanto o app está minimizado/oculto, sem duplicar transmissões.
3. No Tauri, o modo seletor permite compartilhar uma janela ou monitor pelo seletor do Windows.
4. No Tauri, a captura direta inicia a janela ou monitor cadastrados sem abrir o seletor e produz uma faixa de vídeo utilizável pelo pipeline WebRTC existente.
5. O áudio enviado contém somente o processo fonte do perfil; perfis de monitor usam uma fonte de programa explicitamente selecionada. Nenhum caso usa áudio global.
6. Se o destino, o atalho ou a captura de áudio/vídeo estiver inválido, a interface mostra o erro e não deixa captura parcialmente ativa.
7. Encerrar uma transmissão fecha suas capturas e libera recursos sem remover os perfis cadastrados.

## Limite técnico a validar no plano

`Windows.Graphics.Capture` fornece quadros D3D, não uma `MediaStreamTrack` de navegador. Antes de implementar o modo direto completo, o plano precisa validar uma ponte compatível com a versão do WebView2/Tauri e o pipeline PeerJS do projeto, incluindo encerramento e custo de cópia. Se não houver uma ponte de baixa cópia viável sem substituir o pipeline WebRTC, o trabalho deve parar nesse ponto e voltar para revisão do desenho em vez de enviar quadros crus continuamente por IPC.

## Referências técnicas

- [Captura de tela com Windows.Graphics.Capture](https://learn.microsoft.com/en-us/windows/apps/develop/media-authoring-processing/screen-capture)
- [Criar GraphicsCaptureItem para uma janela](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow)
- [Criar GraphicsCaptureItem para um monitor](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createformonitor)
- [Atalhos globais do Electron](https://www.electronjs.org/docs/latest/api/global-shortcut)
- [Plugin oficial de atalhos globais do Tauri](https://v2.tauri.app/plugin/global-shortcut/)
