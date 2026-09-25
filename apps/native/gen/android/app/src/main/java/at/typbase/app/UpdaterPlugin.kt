package at.typbase.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.ktx.startUpdateFlowForResult
import java.io.File
import org.json.JSONArray

/**
 * Android half of the sideload updater: installer intent, the per-app "install
 * unknown apps" flow, and Play Core's in-app update. The Rust commands in
 * `apps/native/src/update.rs` call these through `run_mobile_plugin`.
 */
@InvokeArg
class InstallArgs {
    var path: String? = null
}

@TauriPlugin
class UpdaterPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingPlayInvoke: Invoke? = null

    // Play's update flow needs an IntentSender launcher, and the launcher has to
    // be registered before the activity starts. The plugin is built during
    // onCreate, so this is the last safe moment.
    private val updateLauncher = (activity as? ComponentActivity)?.registerForActivityResult(
        ActivityResultContracts.StartIntentSenderForResult(),
    ) { result ->
        val invoke = pendingPlayInvoke
        pendingPlayInvoke = null
        invoke?.resolve(playResult(result.resultCode))
    }

    private val updateManager: AppUpdateManager? by lazy {
        runCatching { AppUpdateManagerFactory.create(activity) }.getOrNull()
    }

    /** Install source package, so the frontend can tell Play installs apart. */
    @Command
    fun installerSource(invoke: Invoke) {
        val manager = activity.packageManager
        val installer = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            manager.getInstallSourceInfo(activity.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            manager.getInstallerPackageName(activity.packageName)
        }

        val result = JSObject()
        result.put("installer", installer)
        invoke.resolve(result)
    }

    /** Device ABIs, best first; the release manifest is keyed by ABI. */
    @Command
    fun abi(invoke: Invoke) {
        val result = JSObject()
        result.put("abis", JSONArray(Build.SUPPORTED_ABIS.toList()))
        invoke.resolve(result)
    }

    @Command
    fun canInstall(invoke: Invoke) {
        val result = JSObject()
        result.put("canInstall", canRequestInstalls())
        invoke.resolve(result)
    }

    /**
     * Opens the "install unknown apps" screen for this app. Resolves once the
     * user is back; the caller re-checks `canInstall`.
     */
    @Command
    fun requestInstallPermission(invoke: Invoke) {
        if (canRequestInstalls()) {
            invoke.resolve()
            return
        }

        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${activity.packageName}"),
        )
        try {
            startActivityForResult(invoke, intent, "installPermissionResult")
        } catch (e: ActivityNotFoundException) {
            invoke.reject("Could not open the 'install unknown apps' settings screen.")
        }
    }

    @ActivityCallback
    fun installPermissionResult(invoke: Invoke, result: ActivityResult) {
        // The settings screen returns no meaningful result code.
        invoke.resolve()
    }

    /** Launches the system installer for a cached APK. */
    @Command
    fun install(invoke: Invoke) {
        val path = invoke.parseArgs(InstallArgs::class.java).path
        if (path.isNullOrBlank()) {
            invoke.reject("No APK path provided.")
            return
        }

        val file = File(path)
        if (!file.isFile) {
            invoke.reject("APK not found or not a regular file at $path")
            return
        }

        val uri = try {
            FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", file)
        } catch (e: IllegalArgumentException) {
            invoke.reject("APK path is not inside a shareable directory: $path")
            return
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        try {
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: ActivityNotFoundException) {
            invoke.reject("No installer available to handle the APK.")
        } catch (e: Exception) {
            invoke.reject(e.message ?: "Failed to launch the installer.")
        }
    }

    /** Play's available update for this install, if any. */
    @Command
    fun playCheck(invoke: Invoke) {
        val manager = updateManager
        if (manager == null) {
            invoke.reject("Google Play is not available.")
            return
        }

        manager.appUpdateInfo.addOnSuccessListener { info ->
            val result = JSObject()
            result.put("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
            result.put("versionCode", info.availableVersionCode())
            result.put("priority", info.updatePriority())
            invoke.resolve(result)
        }.addOnFailureListener { cause ->
            invoke.reject(cause.message ?: "Could not check Google Play for updates.")
        }
    }

    /** Starts Play's update flow; immediate updates take over the screen. */
    @Command
    fun playStart(invoke: Invoke) {
        val manager = updateManager
        val launcher = updateLauncher
        if (manager == null || launcher == null) {
            invoke.reject("Google Play is not available.")
            return
        }

        manager.appUpdateInfo.addOnSuccessListener { info ->
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE) {
                invoke.resolve(playResult(Activity.RESULT_CANCELED, status = "noUpdate"))
                return@addOnSuccessListener
            }

            pendingPlayInvoke = invoke
            manager.startUpdateFlowForResult(
                info,
                launcher,
                AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
            )
        }.addOnFailureListener { cause ->
            invoke.reject(cause.message ?: "Could not start the Google Play update.")
        }
    }

    private fun playResult(resultCode: Int, status: String? = null): JSObject {
        val result = JSObject()
        result.put(
            "status", status ?: when (resultCode) {
                Activity.RESULT_OK -> "success"
                Activity.RESULT_CANCELED -> "canceled"
                else -> "failed"
            }
        )
        result.put("code", resultCode)
        return result
    }

    private fun canRequestInstalls(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                activity.packageManager.canRequestPackageInstalls()
}
