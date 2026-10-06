package expo.modules.p2pcastmedia

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import android.util.Rational

object PictureInPictureController {
  fun enter(activity: Activity?, hasActiveVideo: Boolean): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || activity == null || !hasActiveVideo) return false
    if (!activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return false

    return runCatching {
      activity.enterPictureInPictureMode(
        PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 9))
          .build(),
      )
    }.getOrDefault(false)
  }

  fun isInPictureInPictureMode(activity: Activity?): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity?.isInPictureInPictureMode == true
}
