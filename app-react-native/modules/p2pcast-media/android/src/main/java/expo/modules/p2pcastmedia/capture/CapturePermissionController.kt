package expo.modules.p2pcastmedia.capture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import expo.modules.p2pcastmedia.service.SessionRegistry
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

data class CapturePermissionResult(
  val granted: Boolean,
  val screenCaptureGranted: Boolean,
  val cameraGranted: Boolean,
  val microphoneGranted: Boolean,
  val screenAudioAvailable: Boolean,
  val reason: String? = null,
) {
  fun toBridgeMap(): Map<String, Any?> = buildMap {
    put("granted", granted)
    put("screenCaptureGranted", screenCaptureGranted)
    put("cameraGranted", cameraGranted)
    put("microphoneGranted", microphoneGranted)
    put("screenAudioAvailable", screenAudioAvailable)
    reason?.let { put("reason", it) }
  }
}

class RuntimePermissionsContract : AppContextActivityResultContract<ArrayList<String>, Map<String, Boolean>> {
  private val contract = ActivityResultContracts.RequestMultiplePermissions()

  override fun createIntent(context: Context, input: ArrayList<String>): Intent =
    contract.createIntent(context, input.toTypedArray())

  override fun parseResult(input: ArrayList<String>, resultCode: Int, intent: Intent?): Map<String, Boolean> =
    contract.parseResult(resultCode, intent)
}

class ScreenCaptureConsentContract : AppContextActivityResultContract<Boolean, Pair<Int, Intent?>> {
  override fun createIntent(context: Context, input: Boolean): Intent =
    context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent()

  override fun parseResult(input: Boolean, resultCode: Int, intent: Intent?): Pair<Int, Intent?> = resultCode to intent
}

class CapturePermissionController(
  private val context: Context,
  private val runtimePermissionLauncher: AppContextActivityResultLauncher<ArrayList<String>, Map<String, Boolean>>,
  private val screenCaptureLauncher: AppContextActivityResultLauncher<Boolean, Pair<Int, Intent?>>,
) {
  private val requestMutex = Mutex()

  suspend fun request(settings: CaptureSettings): CapturePermissionResult = requestMutex.withLock {
    SessionRegistry.clearProjectionGrant()
    val needsCamera = settings.source == CaptureSource.CAMERA || settings.source == CaptureSource.BOTH
    val needsMicrophone = needsCamera && settings.microphone
    val requiredPermissions = buildList {
      if (needsCamera) add(Manifest.permission.CAMERA)
      if (needsMicrophone) add(Manifest.permission.RECORD_AUDIO)
    }
    val missingPermissions = requiredPermissions.filterNot(::isPermissionGranted)

    if (missingPermissions.isNotEmpty()) {
      try {
        requestRuntimePermissions(ArrayList(missingPermissions))
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        return@withLock CapturePermissionResult(
          granted = false,
          screenCaptureGranted = false,
          cameraGranted = !needsCamera,
          microphoneGranted = !needsMicrophone,
          screenAudioAvailable = false,
          reason = error.message ?: "Não foi possível solicitar as permissões do aparelho.",
        )
      }
    }

    val cameraGranted = !needsCamera || isPermissionGranted(Manifest.permission.CAMERA)
    val microphoneGranted = !needsMicrophone || isPermissionGranted(Manifest.permission.RECORD_AUDIO)
    if (!cameraGranted || !microphoneGranted) {
      return@withLock CapturePermissionResult(
        granted = false,
        screenCaptureGranted = settings.source == CaptureSource.CAMERA,
        cameraGranted = cameraGranted,
        microphoneGranted = microphoneGranted,
        screenAudioAvailable = false,
        reason = if (!cameraGranted) "Permita o acesso à câmera para iniciar." else "Permita o acesso ao microfone ou desative essa opção.",
      )
    }

    val needsScreen = settings.source == CaptureSource.SCREEN || settings.source == CaptureSource.BOTH
    if (!needsScreen) {
      return@withLock CapturePermissionResult(
        granted = true,
        screenCaptureGranted = true,
        cameraGranted = cameraGranted,
        microphoneGranted = microphoneGranted,
        screenAudioAvailable = false,
      )
    }

    val (resultCode, data) = try {
      requestScreenCapture()
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      return@withLock CapturePermissionResult(
        granted = false,
        screenCaptureGranted = false,
        cameraGranted = cameraGranted,
        microphoneGranted = microphoneGranted,
        screenAudioAvailable = false,
        reason = error.message ?: "Não foi possível abrir a confirmação de captura de tela.",
      )
    }

    val consentGranted = resultCode == Activity.RESULT_OK && data != null
    if (consentGranted) SessionRegistry.storeProjectionGrant(resultCode to requireNotNull(data))
    CapturePermissionResult(
      granted = consentGranted,
      screenCaptureGranted = consentGranted,
      cameraGranted = cameraGranted,
      microphoneGranted = microphoneGranted,
      screenAudioAvailable = false,
      reason = if (consentGranted) null else "O compartilhamento de tela não foi autorizado.",
    )
  }

  fun hasRequiredRuntimePermissions(settings: CaptureSettings): Boolean {
    val needsCamera = settings.source == CaptureSource.CAMERA || settings.source == CaptureSource.BOTH
    val needsMicrophone = needsCamera && settings.microphone
    return (!needsCamera || isPermissionGranted(Manifest.permission.CAMERA)) &&
      (!needsMicrophone || isPermissionGranted(Manifest.permission.RECORD_AUDIO))
  }

  private fun isPermissionGranted(permission: String): Boolean =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  private suspend fun requestRuntimePermissions(permissions: ArrayList<String>): Map<String, Boolean> =
    withContext(Dispatchers.Main.immediate) {
      suspendCancellableCoroutine { continuation ->
        runtimePermissionLauncher.launch(permissions) { result ->
          if (continuation.isActive) continuation.resume(result)
        }
      }
    }

  private suspend fun requestScreenCapture(): Pair<Int, Intent?> = withContext(Dispatchers.Main.immediate) {
    suspendCancellableCoroutine { continuation ->
      screenCaptureLauncher.launch(true) { result ->
        if (continuation.isActive) continuation.resume(result)
      }
    }
  }
}
