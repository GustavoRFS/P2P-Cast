package com.p2pcast.android.service

import android.content.Context
import android.os.PowerManager

/**
 * Holds a single partial wake lock for the lifetime of an active broadcast or
 * viewing session, so the CPU keeps running (WebRTC encode/decode, the
 * signaling socket) even when the screen turns off. Screen-off itself is fine
 * for WebRTC; what actually kills the session is Android suspending the
 * process — the wake lock plus running inside [StreamForegroundService] is
 * what prevents that.
 */
class WakeLockManager(context: Context) {
    private val powerManager = context.applicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    private var wakeLock: PowerManager.WakeLock? = null

    fun acquire() {
        if (wakeLock?.isHeld == true) return

        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "P2PCast:StreamWakeLock",
        ).apply {
            setReferenceCounted(false)
            acquire(MAX_DURATION_MS)
        }
    }

    fun release() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }

    private companion object {
        // Safety net only: renewed every time the service (re)starts a
        // session, so a stuck lock can't outlive the app for more than ~12h.
        const val MAX_DURATION_MS = 12 * 60 * 60 * 1000L
    }
}
