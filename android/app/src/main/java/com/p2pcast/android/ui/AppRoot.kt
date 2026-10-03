package com.p2pcast.android.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.p2pcast.android.AppViewModel
import com.p2pcast.android.Route
import com.p2pcast.android.capture.CaptureSource
import com.p2pcast.android.ui.screens.BroadcastScreen
import com.p2pcast.android.ui.screens.HomeScreen
import com.p2pcast.android.ui.screens.ViewerScreen

@Composable
fun AppRoot(
    viewModel: AppViewModel,
    inPictureInPictureMode: Boolean,
    supportsPictureInPicture: Boolean,
    onEnterPictureInPicture: () -> Unit,
) {
    val route by viewModel.route.collectAsState()
    val captureSettings by viewModel.captureSettings.collectAsState()
    val context = LocalContext.current

    var pendingSource by remember { mutableStateOf<CaptureSource?>(null) }
    var pendingAfterBattery by remember { mutableStateOf<(() -> Unit)?>(null) }

    // Two system dialogs launched back-to-back (battery exemption, then
    // permissions) race each other — Android only shows the last one
    // requested. Sequencing through this launcher's callback avoids that.
    val batteryOptimizationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        pendingAfterBattery?.invoke()
        pendingAfterBattery = null
    }

    fun requestIgnoreBatteryOptimizationsThen(onDone: () -> Unit) {
        val powerManager = context.getSystemService(PowerManager::class.java)
        if (powerManager?.isIgnoringBatteryOptimizations(context.packageName) == true) {
            onDone()
            return
        }

        val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:${context.packageName}"),
        )
        pendingAfterBattery = onDone
        val launched = runCatching { batteryOptimizationLauncher.launch(intent) }.isSuccess
        if (!launched) {
            pendingAfterBattery = null
            onDone()
        }
    }

    val mediaProjectionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            viewModel.beginBroadcast(result.resultCode to data)
        }
        pendingSource = null
    }

    fun launchScreenCaptureConsent() {
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        mediaProjectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        val source = pendingSource
        if (grants.values.all { it }) {
            if (source == CaptureSource.CAMERA) {
                viewModel.beginBroadcast(null)
                pendingSource = null
            } else if (source != null) {
                launchScreenCaptureConsent()
            }
        } else {
            pendingSource = null
        }
    }

    fun requiredPermissions(source: CaptureSource): List<String> = buildList {
        if (source != CaptureSource.SCREEN) {
            add(Manifest.permission.CAMERA)
            add(Manifest.permission.RECORD_AUDIO)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    fun startBroadcastFlow(source: CaptureSource) {
        requestIgnoreBatteryOptimizationsThen {
            pendingSource = source
            val missing = requiredPermissions(source).filter {
                ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
            }

            when {
                missing.isNotEmpty() -> permissionLauncher.launch(missing.toTypedArray())
                source == CaptureSource.CAMERA -> {
                    viewModel.beginBroadcast(null)
                    pendingSource = null
                }
                else -> launchScreenCaptureConsent()
            }
        }
    }

    Box(Modifier.fillMaxSize()) {
        when (val currentRoute = route) {
            Route.Home -> HomeScreen(
                settings = captureSettings,
                onSettingsChange = { next -> viewModel.updateCaptureSettings { next } },
                onStartBroadcast = { startBroadcastFlow(captureSettings.source) },
                onWatch = { link -> requestIgnoreBatteryOptimizationsThen { viewModel.beginWatching(link) } },
            )

            Route.Broadcast -> {
                val sessionState by viewModel.broadcastSession.collectAsState()
                val session = sessionState
                if (session == null) {
                    Text("Preparando transmissão…", modifier = Modifier.padding(16.dp))
                } else {
                    val mode by session.mode.collectAsState()
                    val error by session.error.collectAsState()
                    val shareUrl by session.shareUrl.collectAsState()
                    val viewerCount by session.viewerCount.collectAsState()
                    val screenTrack by session.localScreenTrack.collectAsState()
                    val cameraTrack by session.localCameraTrack.collectAsState()
                    val audioMuted by session.localAudioMuted.collectAsState()
                    val chatMessages by session.chat.messages.collectAsState()

                    BroadcastScreen(
                        mode = mode,
                        error = error,
                        shareUrl = shareUrl,
                        viewerCount = viewerCount,
                        captureSettings = captureSettings,
                        localScreenTrack = screenTrack,
                        localCameraTrack = cameraTrack,
                        audioMuted = audioMuted,
                        chatMessages = chatMessages,
                        chatSoundEnabled = true,
                        eglBaseContext = viewModel.eglBaseContext,
                        onToggleAudioMute = { session.setLocalAudioMuted(!audioMuted) },
                        onFlipCamera = session::flipCamera,
                        onStop = viewModel::stopBroadcast,
                        onSendChat = { session.chat.send(it) },
                        onToggleChatSound = {},
                        onRetry = { startBroadcastFlow(captureSettings.source) },
                    )
                }
            }

            is Route.Viewer -> {
                val sessionState by viewModel.viewerSession.collectAsState()
                val session = sessionState
                if (session == null) {
                    Text("Conectando…", modifier = Modifier.padding(16.dp))
                } else {
                    val mode by session.mode.collectAsState()
                    val error by session.error.collectAsState()
                    val remoteScreen by session.remoteScreen.collectAsState()
                    val remoteCamera by session.remoteCamera.collectAsState()
                    val chatMessages by session.chat.messages.collectAsState()
                    val chatReady by session.chat.canSend.collectAsState()
                    var audioOn by remember { mutableStateOf(false) }
                    var volume by remember { mutableStateOf(1f) }
                    var viewerName by remember { mutableStateOf("") }

                    ViewerScreen(
                        mode = mode,
                        inPictureInPictureMode = inPictureInPictureMode,
                        supportsPictureInPicture = supportsPictureInPicture,
                        onEnterPictureInPicture = onEnterPictureInPicture,
                        error = error,
                        remoteScreen = remoteScreen,
                        remoteCamera = remoteCamera,
                        audioOn = audioOn,
                        volume = volume,
                        chatMessages = chatMessages,
                        chatReady = chatReady,
                        chatSoundEnabled = true,
                        viewerName = viewerName,
                        eglBaseContext = viewModel.eglBaseContext,
                        onToggleAudio = { audioOn = !audioOn },
                        onVolumeChange = { volume = it },
                        onSendChat = { session.chat.send(it, viewerName) },
                        onToggleChatSound = {},
                        onNameChange = { viewerName = it },
                        onRetry = { viewModel.beginWatching(currentRoute.broadcastId) },
                        onLeave = viewModel::leaveViewer,
                    )
                }
            }
        }
    }
}
