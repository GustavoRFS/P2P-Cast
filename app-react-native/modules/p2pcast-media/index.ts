// Re-export the native module. On web, it will be resolved to P2PCastMediaModule.web.ts
// and on native platforms to P2PCastMediaModule.ts
export { default, P2PCastMedia } from './src/P2PCastMediaModule';
export { default as P2PCastVideoView } from './src/P2PCastMediaView';
export * from './src/P2PCastMedia.types';
