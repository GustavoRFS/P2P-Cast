import { registerWebModule, NativeModule } from 'expo';

import { P2PCastMediaModuleEvents } from './P2PCastMedia.types';

// P2PCastMediaModule is not available on the web platform.
class P2PCastMediaModule extends NativeModule<P2PCastMediaModuleEvents> {}

export default registerWebModule(P2PCastMediaModule, 'P2PCastMediaModule');
