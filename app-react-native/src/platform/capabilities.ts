import { setScreenCaptureSupport } from "../lib/capture";

// Android captures the screen through MediaProjection in the native module, not getDisplayMedia.
setScreenCaptureSupport(true);
