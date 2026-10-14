# P2P-Cast para Android (Expo)

Este app Expo é um cliente Android separado de `../android/`. Ele usa Expo Router e uma Expo Module Kotlin local para compartilhar a tela ou câmera, negociar vídeo WebRTC compatível com os outros clientes P2P-Cast, mostrar o chat e reproduzir a live em Picture-in-Picture.

## Desenvolvimento

```sh
npm ci
npx eas-cli@latest build --platform android --profile development
npx expo start --dev-client
```

O módulo Kotlin de captura e renderização não funciona no Expo Go. Instale o development build antes de iniciar o bundler com `--dev-client`. A captura de tela usa o diálogo de consentimento do Android; câmera e microfone pedem permissões quando a fonte selecionada precisa delas.

O áudio interno da tela aparece como indisponível nesta versão. O microfone é enviado como uma faixa separada junto com a câmera quando ativado. Para espectadores, o áudio começa desligado e pode ser ativado nos controles.

O módulo Kotlin usa `wss://peerjs.ligmacharl.es/peerjs/peerjs` para sinalização. A alteração exige um novo build Android; OTA updates não substituem esse código nativo.

A beta web está em [p2p-cast-react-native-beta.vercel.app](https://p2p-cast-react-native-beta.vercel.app), separada do site legado. Ela exporta a interface React Native; captura, vídeo ao vivo e PiP continuam disponíveis somente no app Android.

## Builds EAS

O projeto EAS é [`gustavorfsdev/app-react-native`](https://expo.dev/accounts/gustavorfsdev/projects/app-react-native). O arquivo `eas.json` define os canais `development`, `preview` e `production`:

```sh
npx eas-cli@latest build --platform android --profile preview
npx eas-cli@latest build --platform android --profile production
```

Os profiles `preview` e `production` usam distribuição interna e de loja, respectivamente, e cada um tem seu próprio canal OTA.

## EAS Update (OTA)

O app usa `expo-updates`, runtime version com política `appVersion` e o projeto EAS configurado no `app.json`. Publique alterações de JavaScript, estilos e assets em um canal compatível:

```sh
npx eas-cli@latest update --channel preview --platform android --message "Descreva a atualização" --environment preview
npx eas-cli@latest update --channel production --platform android --message "Descreva a atualização" --environment production
```

O build instalado precisa ter sido criado com o mesmo canal e runtime version. Uma versão release pode iniciar com o bundle atual enquanto baixa o update; feche o app e abra-o novamente para aplicar o conteúdo baixado.

Alterações no módulo Kotlin, permissões, configuração Android, dependências nativas ou SDK precisam de um novo build. Como o runtime segue `expo.version`, aumente essa versão ao preparar uma nova geração nativa e distribua o build antes de publicar updates para ela. Não publique um update destinado a uma geração nova no canal de builds antigos.

O setup deste repositório não publica updates nem inicia builds. Uma conta Expo autenticada é necessária para operações EAS.
