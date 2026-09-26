package at.typbase.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
    }

    // Play's in-app update reports here: the plugin cannot register its own
    // ActivityResultLauncher because Tauri builds it after the activity resumes.
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == UpdaterPlugin.PLAY_UPDATE_REQUEST) {
            UpdaterPlugin.onPlayUpdateResult(resultCode)
        }
    }
}
