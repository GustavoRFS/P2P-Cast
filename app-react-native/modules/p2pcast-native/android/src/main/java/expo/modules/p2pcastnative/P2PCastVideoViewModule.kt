package expo.modules.p2pcastnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class P2PCastVideoViewModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("P2PCastVideoView")

        View(P2PCastVideoView::class) {
            Prop("trackId") { view: P2PCastVideoView, trackId: String? -> view.setTrackId(trackId) }
            Prop("fit") { view: P2PCastVideoView, fit: String? -> view.setFit(fit ?: "contain") }
            Prop("mirror") { view: P2PCastVideoView, mirror: Boolean? -> view.setMirror(mirror ?: false) }
            Prop("overlay") { view: P2PCastVideoView, overlay: Boolean? -> view.setOverlay(overlay ?: false) }
            OnViewDestroys { view: P2PCastVideoView -> view.release() }
        }
    }
}
