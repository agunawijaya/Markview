package com.markview.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.OpenableColumns
import android.view.View
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.view.WindowCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class UriArgs {
  lateinit var uri: String
}

@InvokeArg
class PrintArgs {
  var name: String = "Markview"
}

@InvokeArg
class ThemeArgs {
  var dark: Boolean = false
}

/**
 * Android services the stock Tauri plugins don't cover. Registered from Rust
 * (src-tauri/src/android.rs) and only reachable through Markview's own Rust
 * commands, never directly from JavaScript.
 */
@TauriPlugin
class MarkviewBridgePlugin(private val activity: Activity) : Plugin(activity) {
  private var webView: WebView? = null

  // A document handed to us by "Open with Markview", waiting for the frontend
  // to pick it up via takeIntentFile.
  private var pendingUri: String? = null

  override fun load(webView: WebView) {
    this.webView = webView
    capture(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    if (capture(intent)) {
      // The app was already running: nudge the frontend to open it now.
      webView?.post {
        webView?.evaluateJavascript("window.__markviewOpenIntentFile && window.__markviewOpenIntentFile()", null)
      }
    }
  }

  private fun capture(intent: Intent?): Boolean {
    if (intent == null) return false
    if (intent.action != Intent.ACTION_VIEW && intent.action != Intent.ACTION_EDIT) return false
    val uri = intent.data ?: return false
    pendingUri = if (uri.scheme == "file") uri.path else uri.toString()
    // Consume it so a configuration change doesn't reopen the same file.
    intent.data = null
    return pendingUri != null
  }

  @Command
  fun takeIntentFile(invoke: Invoke) {
    val ret = JSObject()
    pendingUri?.let { ret.put("uri", it) }
    pendingUri = null
    invoke.resolve(ret)
  }

  /** System document picker. OPEN_DOCUMENT (unlike GET_CONTENT) grants write access, so Save works. */
  @Command
  fun pickDocument(invoke: Invoke) {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      // Markdown has no reliable MIME type on Android (text/markdown, text/plain,
      // application/octet-stream all occur), so don't grey anything out.
      type = "*/*"
    }
    startActivityForResult(invoke, intent, "pickDocumentResult")
  }

  @ActivityCallback
  fun pickDocumentResult(invoke: Invoke, result: ActivityResult) {
    val ret = JSObject()
    val uri = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
    if (uri != null) {
      // Keep access across app restarts so the last document can be reopened.
      try {
        activity.contentResolver.takePersistableUriPermission(
          uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
      } catch (_: Exception) {
        try {
          activity.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
      }
      ret.put("uri", uri.toString())
    }
    invoke.resolve(ret)
  }

  @Command
  fun displayName(invoke: Invoke) {
    val args = invoke.parseArgs(UriArgs::class.java)
    val ret = JSObject()
    try {
      activity.contentResolver.query(
        Uri.parse(args.uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
      )?.use { cursor ->
        val col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (col >= 0 && cursor.moveToFirst()) ret.put("name", cursor.getString(col))
      }
    } catch (_: Exception) {
    }
    invoke.resolve(ret)
  }

  /** Android WebView ignores window.print(); hand the page to the system print service instead. */
  @Command
  fun print(invoke: Invoke) {
    val args = invoke.parseArgs(PrintArgs::class.java)
    val view = webView ?: return invoke.reject("WebView not ready")
    val printManager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
    printManager.print(args.name, view.createPrintDocumentAdapter(args.name), PrintAttributes.Builder().build())
    invoke.resolve()
  }

  /** Paint the strips behind the status/navigation bars to match the app's light/dark theme. */
  @Command
  fun setSystemBarTheme(invoke: Invoke) {
    val args = invoke.parseArgs(ThemeArgs::class.java)
    val color = if (args.dark) Color.parseColor("#252525") else Color.parseColor("#F8F8F8")
    activity.findViewById<View>(android.R.id.content)?.setBackgroundColor(color)
    activity.window.decorView.setBackgroundColor(color)
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).apply {
      isAppearanceLightStatusBars = !args.dark
      isAppearanceLightNavigationBars = !args.dark
    }
    invoke.resolve()
  }

  /** Back on the root screen: behave like other Android apps and go to the background. */
  @Command
  fun moveToBack(invoke: Invoke) {
    invoke.resolve()
    activity.moveTaskToBack(true)
  }
}
