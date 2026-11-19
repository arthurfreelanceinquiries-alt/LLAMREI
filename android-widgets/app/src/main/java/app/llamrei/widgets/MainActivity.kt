package app.llamrei.widgets

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import kotlin.concurrent.thread

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorLayout: LinearLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Dark theme status & navigation bar
        window.statusBarColor = 0xFF050507.toInt()
        window.navigationBarColor = 0xFF050507.toInt()

        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF050507.toInt())
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            setBackgroundColor(0xFF050507.toInt())
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                useWideViewPort = true
                loadWithOverviewMode = true
                cacheMode = WebSettings.LOAD_DEFAULT
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                }
            }
        }

        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, 8)
            isIndeterminate = false
            max = 100
            progressDrawable.setColorFilter(0xFF00D992.toInt(), android.graphics.PorterDuff.Mode.SRC_IN)
            visibility = View.VISIBLE
        }

        // Error / Offline Screen
        errorLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setBackgroundColor(0xFF050507.toInt())
            visibility = View.GONE
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }

        val errIcon = TextView(this).apply {
            text = "⚡"
            textSize = 48f
            gravity = android.view.Gravity.CENTER
        }
        val errTitle = TextView(this).apply {
            text = "Menghubungkan ke Dashboard Llamrei..."
            textSize = 16f
            setTextColor(0xFF00D992.toInt())
            gravity = android.view.Gravity.CENTER
            setPadding(0, 16, 0, 8)
        }
        val errDesc = TextView(this).apply {
            text = "Pastikan Tailscale di HP Anda aktif (Connected) atau HP tersambung ke Wi-Fi yang sama dengan laptop."
            textSize = 12f
            setTextColor(0xFF94A3B8.toInt())
            gravity = android.view.Gravity.CENTER
            setPadding(0, 0, 0, 24)
        }
        val btnRetry = Button(this).apply {
            text = "Coba Hubungkan Lagi"
            setBackgroundColor(0xFF00D992.toInt())
            setTextColor(0xFF050507.toInt())
            setOnClickListener {
                errorLayout.visibility = View.GONE
                webView.visibility = View.VISIBLE
                loadDashboardUrl()
            }
        }
        val btnConfig = Button(this).apply {
            text = "Pengaturan Server IP"
            setBackgroundColor(0xFF1E293B.toInt())
            setTextColor(0xFFE2E8F0.toInt())
            setOnClickListener {
                startActivity(Intent(this@MainActivity, ServerConfigActivity::class.java))
            }
        }

        errorLayout.addView(errIcon)
        errorLayout.addView(errTitle)
        errorLayout.addView(errDesc)
        errorLayout.addView(btnRetry)
        errorLayout.addView(btnConfig)

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("https://wa.me") || url.startsWith("whatsapp://") || url.startsWith("intent://") || url.startsWith("tel:") || url.startsWith("mailto:")) {
                    return try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                        true
                    } catch (e: Exception) {
                        false
                    }
                }
                return false
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                progressBar.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                progressBar.visibility = View.GONE
                errorLayout.visibility = View.GONE
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    progressBar.visibility = View.GONE
                    webView.visibility = View.GONE
                    errorLayout.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                progressBar.progress = newProgress
                if (newProgress >= 100) {
                    progressBar.visibility = View.GONE
                }
            }
        }

        root.addView(webView)
        root.addView(progressBar)
        root.addView(errorLayout)
        setContentView(root)

        loadDashboardUrl()

        // Background widget sync every time app opens
        thread {
            val snap = LlamreiWidgetSync.syncWithServer(this)
            refreshAllWidgetProviders(this, snap)
        }
    }

    private fun loadDashboardUrl() {
        val (lan, ts, _) = LlamreiWidgetSync.getEndpoints(this)
        // Primary: Tailscale IP (works anywhere via VPN or Wi-Fi); fallback to LAN IP
        val target = if (ts.isNotBlank()) ts else lan
        webView.loadUrl(target)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onResume() {
        super.onResume()
        thread {
            val snap = LlamreiWidgetSync.syncWithServer(this)
            refreshAllWidgetProviders(this, snap)
        }
    }
}
