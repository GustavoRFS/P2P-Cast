package com.p2pcast.android

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.p2pcast.android.ui.AppRoot
import com.p2pcast.android.ui.theme.P2PCastTheme

class MainActivity : ComponentActivity() {
    private var pendingDeepLink by mutableStateOf<String?>(null)
    private var inPictureInPictureMode by mutableStateOf(false)

    private val supportsPictureInPicture: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingDeepLink = intent?.dataString

        setContent {
            P2PCastTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRootEntry(
                        deepLink = pendingDeepLink,
                        onDeepLinkConsumed = { pendingDeepLink = null },
                        inPictureInPictureMode = inPictureInPictureMode,
                        supportsPictureInPicture = supportsPictureInPicture,
                        onEnterPictureInPicture = ::enterPictureInPicture,
                    )
                }
            }
        }
    }

    private fun enterPictureInPicture() {
        if (!supportsPictureInPicture || inPictureInPictureMode) return

        val params = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .build()
        enterPictureInPictureMode(params)
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPictureInPictureMode = isInPictureInPictureMode
    }

    // App Links deliver here (not onCreate) when the app is already running,
    // since MainActivity is singleTask and gets reused instead of recreated.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingDeepLink = intent.dataString
    }
}

@Composable
private fun AppRootEntry(
    deepLink: String?,
    onDeepLinkConsumed: () -> Unit,
    inPictureInPictureMode: Boolean,
    supportsPictureInPicture: Boolean,
    onEnterPictureInPicture: () -> Unit,
) {
    val viewModel: AppViewModel = viewModel(factory = AppViewModel.factory())

    LaunchedEffect(deepLink) {
        if (deepLink != null) {
            viewModel.stopBroadcast()
            viewModel.leaveViewer()
            viewModel.beginWatching(deepLink)
            onDeepLinkConsumed()
        }
    }

    AppRoot(
        viewModel = viewModel,
        inPictureInPictureMode = inPictureInPictureMode,
        supportsPictureInPicture = supportsPictureInPicture,
        onEnterPictureInPicture = onEnterPictureInPicture,
    )
}
