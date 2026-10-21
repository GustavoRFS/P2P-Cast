package com.p2pcast.android.capture

import android.content.Context
import android.content.SharedPreferences

/**
 * Kotlin port of the web app's src/lib/capture.ts option catalogue, kept in
 * lockstep so both clients offer the same knobs. Cursor visibility has no
 * Android MediaProjection equivalent and is intentionally dropped; everything
 * else (source, resolution, fps, bitrate, mic/screen-audio, camera facing)
 * carries over 1:1.
 */

enum class CaptureSource { SCREEN, CAMERA, BOTH }

/** The two concrete media tracks a broadcast can carry; BOTH expands to these. */
enum class CaptureTrackSource { SCREEN, CAMERA }

fun CaptureSource.tracks(): List<CaptureTrackSource> = when (this) {
    CaptureSource.SCREEN -> listOf(CaptureTrackSource.SCREEN)
    CaptureSource.CAMERA -> listOf(CaptureTrackSource.CAMERA)
    CaptureSource.BOTH -> listOf(CaptureTrackSource.SCREEN, CaptureTrackSource.CAMERA)
}

enum class CameraFacing { USER, ENVIRONMENT }

data class Resolution(val label: String, val width: Int?, val height: Int?) {
    companion object {
        val ORIGINAL = Resolution("Original", null, null)
        val P360 = Resolution("360p", 640, 360)
        val P480 = Resolution("480p", 854, 480)
        val P720 = Resolution("720p", 1280, 720)
        val P1080 = Resolution("1080p", 1920, 1080)
        val K2 = Resolution("2K", 2560, 1440)
        val K4 = Resolution("4K", 3840, 2160)
        val K8 = Resolution("8K", 7680, 4320)

        val ALL = listOf(ORIGINAL, P360, P480, P720, P1080, K2, K4, K8)

        fun fromLabel(label: String): Resolution = ALL.find { it.label == label } ?: P1080
    }
}

val FPS_OPTIONS = listOf(15, 24, 30, 60, 120, 144, 160, 200, 240)

data class BitrateOption(val label: String, val value: Int?)

val BITRATE_OPTIONS = listOf(
    BitrateOption("Automático", null),
    BitrateOption("2 Mbps", 2_000_000),
    BitrateOption("4 Mbps", 4_000_000),
    BitrateOption("6 Mbps", 6_000_000),
    BitrateOption("8 Mbps", 8_000_000),
    BitrateOption("12 Mbps", 12_000_000),
)

data class CaptureSettings(
    val source: CaptureSource = CaptureSource.SCREEN,
    val resolution: Resolution = Resolution.P1080,
    val fps: Int = 30,
    val bitrate: Int? = 6_000_000,
    val screenAudio: Boolean = true,
    val microphone: Boolean = true,
    val cameraFacing: CameraFacing = CameraFacing.USER,
) {
    companion object {
        val DEFAULT = CaptureSettings()
    }
}

fun formatCaptureSettings(settings: CaptureSettings): String {
    val bitrateLabel = BITRATE_OPTIONS.find { it.value == settings.bitrate }?.label ?: "Automático"
    val sourceLabel = when (settings.source) {
        CaptureSource.SCREEN -> "tela"
        CaptureSource.CAMERA -> "câmera"
        CaptureSource.BOTH -> "tela + câmera"
    }
    val audioLabel = when (settings.source) {
        CaptureSource.CAMERA -> if (settings.microphone) "com microfone" else "sem microfone"
        CaptureSource.BOTH -> {
            val screen = if (settings.screenAudio) "áudio da tela" else "sem áudio da tela"
            val mic = if (settings.microphone) "microfone" else "sem microfone"
            "$screen · $mic"
        }
        CaptureSource.SCREEN -> if (settings.screenAudio) "com áudio" else "sem áudio"
    }
    val resolutionLabel = settings.resolution.label
    return "$sourceLabel · $resolutionLabel · ${settings.fps} FPS · $bitrateLabel · $audioLabel"
}

private const val PREFS_NAME = "p2pcast_prefs"
private const val KEY_SOURCE = "capture.source"
private const val KEY_RESOLUTION = "capture.resolution"
private const val KEY_FPS = "capture.fps"
private const val KEY_BITRATE = "capture.bitrate"
private const val KEY_SCREEN_AUDIO = "capture.screen_audio"
private const val KEY_MICROPHONE = "capture.microphone"
private const val KEY_CAMERA_FACING = "capture.camera_facing"

class CaptureSettingsStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): CaptureSettings {
        val default = CaptureSettings.DEFAULT
        return CaptureSettings(
            source = prefs.getString(KEY_SOURCE, null)?.let { runCatching { CaptureSource.valueOf(it) }.getOrNull() }
                ?: default.source,
            resolution = prefs.getString(KEY_RESOLUTION, null)?.let { Resolution.fromLabel(it) } ?: default.resolution,
            fps = prefs.getInt(KEY_FPS, default.fps).takeIf { it in FPS_OPTIONS } ?: default.fps,
            bitrate = if (prefs.contains(KEY_BITRATE)) {
                prefs.getInt(KEY_BITRATE, 0).takeIf { it != 0 }
            } else default.bitrate,
            screenAudio = prefs.getBoolean(KEY_SCREEN_AUDIO, default.screenAudio),
            microphone = prefs.getBoolean(KEY_MICROPHONE, default.microphone),
            cameraFacing = prefs.getString(KEY_CAMERA_FACING, null)
                ?.let { runCatching { CameraFacing.valueOf(it) }.getOrNull() } ?: default.cameraFacing,
        )
    }

    fun save(settings: CaptureSettings) {
        prefs.edit()
            .putString(KEY_SOURCE, settings.source.name)
            .putString(KEY_RESOLUTION, settings.resolution.label)
            .putInt(KEY_FPS, settings.fps)
            .apply {
                if (settings.bitrate == null) remove(KEY_BITRATE) else putInt(KEY_BITRATE, settings.bitrate)
            }
            .putBoolean(KEY_SCREEN_AUDIO, settings.screenAudio)
            .putBoolean(KEY_MICROPHONE, settings.microphone)
            .putString(KEY_CAMERA_FACING, settings.cameraFacing.name)
            .apply()
    }
}
