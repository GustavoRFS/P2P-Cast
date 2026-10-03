package com.p2pcast.android

import android.app.Application
import android.content.Intent
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewModelScope
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.capture.CaptureSettingsStore
import com.p2pcast.android.rtc.BroadcastSession
import com.p2pcast.android.rtc.ViewerSession
import com.p2pcast.android.rtc.WebRtcEngine
import com.p2pcast.android.service.StreamForegroundService
import com.p2pcast.android.util.parseWatchId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

sealed class Route {
    data object Home : Route()
    data object Broadcast : Route()
    data class Viewer(val broadcastId: String) : Route()
}

/**
 * Top-level state holder mirroring App.tsx's mode-based routing (idle vs.
 * broadcaster vs. viewer), except routing here is an explicit user action
 * (there's no browser address bar) rather than a `?watch=` query string.
 */
class AppViewModel(application: Application) : AndroidViewModel(application) {
    private val captureSettingsStore = CaptureSettingsStore(application)
    private val engine = WebRtcEngine(application)

    private val _route = MutableStateFlow<Route>(Route.Home)
    val route: StateFlow<Route> = _route.asStateFlow()

    private val _captureSettings = MutableStateFlow(captureSettingsStore.load())
    val captureSettings: StateFlow<CaptureSettings> = _captureSettings.asStateFlow()

    private val _broadcastSession = MutableStateFlow<BroadcastSession?>(null)
    val broadcastSession: StateFlow<BroadcastSession?> = _broadcastSession.asStateFlow()
    private val _viewerSession = MutableStateFlow<ViewerSession?>(null)
    val viewerSession: StateFlow<ViewerSession?> = _viewerSession.asStateFlow()

    val eglBaseContext get() = engine.eglBaseContext

    fun updateCaptureSettings(update: (CaptureSettings) -> CaptureSettings) {
        val next = update(_captureSettings.value)
        _captureSettings.value = next
        captureSettingsStore.save(next)
    }

    /** Called once permissions/MediaProjection consent are already granted. */
    fun beginBroadcast(mediaProjectionResult: Pair<Int, Intent>?) {
        val settings = _captureSettings.value
        _route.value = Route.Broadcast

        // Screen capture's MediaProjection.getMediaProjection() requires the
        // foreground service to already be running, or the OS throws.
        StreamForegroundService.start(getApplication(), roleFor(settings.source))
        viewModelScope.launch {
            withTimeoutOrNull(3_000) { StreamForegroundService.isForeground.first { it } }
            val session = engine.createBroadcastSession(viewModelScope, mediaProjectionResult)
            _broadcastSession.value = session
            session.start(settings)
        }
    }

    fun beginWatching(rawLinkOrId: String) {
        val id = parseWatchId(rawLinkOrId) ?: rawLinkOrId.trim()
        if (id.isEmpty()) return

        val session = engine.createViewerSession(viewModelScope)
        _viewerSession.value = session
        _route.value = Route.Viewer(id)
        session.connect(id)
        StreamForegroundService.start(getApplication(), StreamForegroundService.ROLE_VIEWER)
    }

    fun stopBroadcast() {
        _broadcastSession.value?.stop()
        _broadcastSession.value = null
        StreamForegroundService.stop(getApplication())
        _route.value = Route.Home
    }

    fun leaveViewer() {
        _viewerSession.value?.disconnect()
        _viewerSession.value = null
        StreamForegroundService.stop(getApplication())
        _route.value = Route.Home
    }

    override fun onCleared() {
        _broadcastSession.value?.stop()
        _viewerSession.value?.disconnect()
        engine.release()
        super.onCleared()
    }

    private fun roleFor(source: com.p2pcast.android.capture.CaptureSource) = when (source) {
        com.p2pcast.android.capture.CaptureSource.SCREEN -> StreamForegroundService.ROLE_BROADCAST_SCREEN
        com.p2pcast.android.capture.CaptureSource.CAMERA -> StreamForegroundService.ROLE_BROADCAST_CAMERA
        com.p2pcast.android.capture.CaptureSource.BOTH -> StreamForegroundService.ROLE_BROADCAST_BOTH
    }

    companion object {
        fun factory(): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
                val application = checkNotNull(extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
                return AppViewModel(application) as T
            }
        }
    }
}
