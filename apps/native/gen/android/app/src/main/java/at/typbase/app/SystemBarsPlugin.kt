package at.typbase.app

import android.app.Activity
import androidx.core.view.WindowCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class SystemBarsArgs {
    var light: Boolean = true
}

/**
 * System bar icon tint, driven by the web app's resolved theme.
 *
 * `enableEdgeToEdge()` picks the tint from the system dark mode, so a light
 * workspace on a dark phone drew white status and navigation icons over the
 * white app surface. The web layer calls [setLight] whenever `data-theme`
 * changes. The bars stay transparent; the app paints under them, and the
 * `--safe-*` insets keep content clear of the icons.
 */
@TauriPlugin
class SystemBarsPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun setLight(invoke: Invoke) {
        val light = invoke.parseArgs(SystemBarsArgs::class.java).light

        activity.runOnUiThread {
            val controller =
                WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            controller.isAppearanceLightStatusBars = light
            controller.isAppearanceLightNavigationBars = light
            invoke.resolve()
        }
    }
}
