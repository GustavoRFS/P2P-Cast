package expo.modules.p2pcastmedia.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout

class StreamForegroundService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val role = intent?.getStringExtra(EXTRA_ROLE) ?: ROLE_SCREEN
    ensureNotificationChannel()
    val notification = buildNotification(role)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, foregroundTypes(role))
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      synchronized(startLock) {
        if (pendingStart?.role == role) {
          pendingStart?.ready?.complete(Unit)
          pendingStart = null
        }
      }
    } catch (error: Throwable) {
      synchronized(startLock) {
        pendingStart?.ready?.completeExceptionally(error)
        pendingStart = null
      }
      stopSelf(startId)
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun foregroundTypes(role: String): Int {
    var types = 0
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && role in setOf(ROLE_SCREEN, ROLE_BOTH, ROLE_BOTH_MICROPHONE)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && role in setOf(ROLE_CAMERA, ROLE_CAMERA_MICROPHONE, ROLE_BOTH, ROLE_BOTH_MICROPHONE)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && role in setOf(ROLE_CAMERA_MICROPHONE, ROLE_BOTH_MICROPHONE)) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return types
  }

  private fun buildNotification(role: String) = NotificationCompat.Builder(this, CHANNEL_ID)
    .setSmallIcon(android.R.drawable.ic_menu_camera)
    .setContentTitle("p2pcast")
    .setContentText(
      if (role == ROLE_SCREEN || role == ROLE_CAMERA || role == ROLE_CAMERA_MICROPHONE || role == ROLE_BOTH || role == ROLE_BOTH_MICROPHONE)
        "Sua transmissão continua ativa em segundo plano."
      else
        "Sua sessão está ativa.",
    )
    .setCategory(NotificationCompat.CATEGORY_SERVICE)
    .setOngoing(true)
    .setPriority(NotificationCompat.PRIORITY_LOW)
    .setContentIntent(openAppPendingIntent())
    .build()

  private fun openAppPendingIntent(): PendingIntent? {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName) ?: return null
    launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Transmissão ativa", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Mantém a captura da tela ou câmera ativa durante a transmissão."
      },
    )
  }

  companion object {
    private const val CHANNEL_ID = "p2pcast_stream"
    private const val NOTIFICATION_ID = 42
    private const val EXTRA_ROLE = "role"
    private val startLock = Any()
    private var pendingStart: PendingStart? = null

    const val ROLE_SCREEN = "screen"
    const val ROLE_CAMERA = "camera"
    const val ROLE_CAMERA_MICROPHONE = "camera_microphone"
    const val ROLE_BOTH = "both"
    const val ROLE_BOTH_MICROPHONE = "both_microphone"

    private data class PendingStart(val role: String, val ready: CompletableDeferred<Unit>)

    suspend fun startAndAwait(context: Context, role: String) {
      val ready = CompletableDeferred<Unit>()
      synchronized(startLock) { pendingStart = PendingStart(role, ready) }
      try {
        val intent = Intent(context, StreamForegroundService::class.java).putExtra(EXTRA_ROLE, role)
        ContextCompat.startForegroundService(context, intent)
        withTimeout(10_000) { ready.await() }
      } catch (error: Throwable) {
        synchronized(startLock) {
          if (pendingStart?.ready === ready) pendingStart = null
        }
        throw error
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, StreamForegroundService::class.java))
    }
  }
}
