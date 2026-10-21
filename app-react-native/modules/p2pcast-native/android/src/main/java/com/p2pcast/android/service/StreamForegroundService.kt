package com.p2pcast.android.service

import android.app.Notification
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
import expo.modules.p2pcastnative.R
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Keeps the process alive (and, on screen capture, keeps MediaProjection
 * legal to run) while a broadcast or viewing session is active. Android kills
 * background processes aggressively; a foreground service + notification is
 * the only reliable way to survive the user switching apps or locking the
 * screen mid-stream. Paired with [WakeLockManager] for the CPU side.
 *
 * Must be started (via [start]) *before* [StreamForegroundService] handles
 * are torn down, and stopped with [stop] as soon as the session ends —
 * leaving it running with nothing to show would be a silent battery drain.
 */
class StreamForegroundService : Service() {

    private val wakeLockManager by lazy { WakeLockManager(this) }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val role = intent?.getStringExtra(EXTRA_ROLE) ?: ROLE_VIEWER
        val fgsTypes = foregroundServiceTypesFor(role)

        ensureChannel()
        val notification = buildNotification(role)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, fgsTypes)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        wakeLockManager.acquire()
        // MediaProjection.getMediaProjection() throws SecurityException unless called
        // after startForeground() has actually run — this flag lets callers await that.
        _isForeground.value = true
        return START_STICKY
    }

    override fun onDestroy() {
        _isForeground.value = false
        wakeLockManager.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun foregroundServiceTypesFor(role: String): Int {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0

        return when (role) {
            ROLE_BROADCAST_SCREEN -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            ROLE_BROADCAST_CAMERA -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            ROLE_BROADCAST_BOTH -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                0
            }
        }
    }

    private fun buildNotification(role: String): Notification {
        val contentText = when (role) {
            ROLE_BROADCAST_SCREEN, ROLE_BROADCAST_CAMERA, ROLE_BROADCAST_BOTH ->
                "Sua transmissão continua ativa em segundo plano."
            else -> "Você continua assistindo em segundo plano."
        }

        // The host app's launcher activity (the Expo app), whatever its class is.
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: Intent()
        val openAppIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("p2pcast")
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_stat_stream)
            .setOngoing(true)
            .setContentIntent(openAppIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Transmissão ativa",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Mantém a transmissão ou a exibição ativa em segundo plano."
            },
        )
    }

    companion object {
        private const val CHANNEL_ID = "p2pcast_stream"
        private const val NOTIFICATION_ID = 42
        private const val EXTRA_ROLE = "role"

        const val ROLE_BROADCAST_SCREEN = "broadcast_screen"
        const val ROLE_BROADCAST_CAMERA = "broadcast_camera"
        const val ROLE_BROADCAST_BOTH = "broadcast_both"
        const val ROLE_VIEWER = "viewer"

        private val _isForeground = MutableStateFlow(false)

        /** Flips to true once `onStartCommand` has called `startForeground()`.
         * Screen-capture callers must suspend on this before requesting the
         * MediaProjection, or the OS throws a SecurityException. */
        val isForeground: StateFlow<Boolean> = _isForeground.asStateFlow()

        fun start(context: Context, role: String) {
            val intent = Intent(context, StreamForegroundService::class.java).putExtra(EXTRA_ROLE, role)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, StreamForegroundService::class.java))
        }
    }
}
