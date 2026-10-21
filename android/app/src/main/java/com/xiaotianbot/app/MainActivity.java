package com.xiaotianbot.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

/**
 * One full-screen WebView. It shows the start page (assets/start.html) until a computer is paired, then the 小天 Bot page
 * that computer serves on the local network (tianxi/web, laid out for phones by mobile.js). The page reaches the phone
 * through window.XiaotianNative: open UU 远程, scan a pairing code, remember and switch computers.
 * UU 远程 answers through xiaotian://uu/… links, handed to the page as window.onXiaotianLink(url).
 */
public class MainActivity extends Activity {
    static final String START = "file:///android_asset/start.html";
    static final int REQ_SCAN = 1, REQ_FILE = 2;

    private FrameLayout root;
    private WebView web;
    private Hosts saved;
    /** the computer being opened or paired with: its pages may load before it is saved */
    private String pending;
    /** a UU 远程 answer that arrived before the page could take it */
    private String pendingLink;
    /** the last computer page finished loading, so onXiaotianLink exists */
    private boolean ready;
    private boolean clearHistory;
    private ValueCallback<Uri[]> fileCb;

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        saved = new Hosts(this);
        Window w = getWindow();
        // the page draws edge to edge; the padding below keeps it clear of the status and navigation bars
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        else w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) w.setNavigationBarContrastEnforced(false);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " XiaotianApp/" + BuildConfig.VERSION_NAME + " (" + Uri.encode(deviceName()) + ")");
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.addJavascriptInterface(new Bridge(), "XiaotianNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        Hosts.Host h = saved.current();
        if (h != null) open(h);
        else home(null);
        link(getIntent());
    }

    /** what the computer lists this phone as: the name set in the phone's settings, else its maker and model */
    private String deviceName() {
        String n = null;
        try {
            n = Settings.Global.getString(getContentResolver(), "device_name");
        } catch (Exception ignored) {
        }
        if (n == null || n.trim().isEmpty()) {
            String m = Build.MODEL, b = Build.MANUFACTURER;
            n = m.toLowerCase().startsWith(b.toLowerCase()) ? m : b + " " + m;
        }
        return n.replaceAll("[()\\r\\n]", " ").trim();
    }

    private void open(Hosts.Host h) {
        pending = h.origin;
        ready = false;
        clearHistory = true;
        web.loadUrl(h.origin + "/?t=" + Uri.encode(h.token));
    }

    /** the start page; err names the computer that could not be reached */
    private void home(String err) {
        pending = null;
        ready = false;
        clearHistory = true;
        bars("#000000", false);
        web.loadUrl(START + (err != null ? "#err=" + Uri.encode(err) : ""));
    }

    /** a pairing link from the QR code, or typed on the start page: http://<computer>:3091/pair?c=<code> */
    private void pair(String url) {
        Uri u = Uri.parse(url == null ? "" : url.trim());
        String origin = Hosts.originOf(u.toString());
        if (origin == null || !"/pair".equals(u.getPath()) || u.getQueryParameter("c") == null) {
            toast("这不是小天 Bot 的配对码");
            return;
        }
        pending = origin;
        ready = false;
        clearHistory = true;
        web.loadUrl(u.toString());
    }

    private boolean trusted(String origin) {
        return origin != null && (origin.equals(pending) || saved.has(origin));
    }

    private boolean canOpen(Uri u) {
        return !getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_VIEW, u), 0).isEmpty();
    }

    @SuppressWarnings("deprecation")
    private void bars(String color, boolean light) {
        int c;
        try {
            c = Color.parseColor(color);
        } catch (Exception e) {
            return;
        }
        root.setBackgroundColor(c);
        web.setBackgroundColor(c);
        getWindow().setBackgroundDrawable(new ColorDrawable(c));
        View d = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController ic = d.getWindowInsetsController();
            if (ic != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                ic.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else {
            int f = d.getSystemUiVisibility();
            int mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | (Build.VERSION.SDK_INT >= 26 ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            d.setSystemUiVisibility(light ? f | mask : f & ~mask);
        }
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }

    private void js(String code) {
        web.evaluateJavascript(code, null);
    }

    // ---------- UU 远程 answers: xiaotian://uu/authorize?… and xiaotian://uu/control?… ----------
    private void link(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u == null || !"xiaotian".equals(u.getScheme()) || !"uu".equals(u.getHost())) return;
        i.setData(null);
        pendingLink = u.toString();
        deliver();
    }

    private void deliver() {
        if (pendingLink == null || !ready) return;
        String l = pendingLink;
        pendingLink = null;
        js("window.onXiaotianLink&&window.onXiaotianLink(" + JSONObject.quote(l) + ")");
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        link(i);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // back from UU 远程: the page hands the computer back to the Bots
        if (ready) js("window.onXiaotianResume&&window.onXiaotianResume()");
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // the page goes back first (a sheet, a chat, a sub-page); at its top level the App goes to the background
        web.evaluateJavascript("window.mobBack?window.mobBack():false", (v) -> {
            if ("true".equals(v)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_SCAN && res == RESULT_OK && data != null) {
            if (data.getBooleanExtra("manual", false)) js("window.showManual&&window.showManual()");
            else pair(data.getStringExtra("text"));
        } else if (req == REQ_SCAN && res == RESULT_OK) {
            js("window.showManual&&window.showManual()");
        } else if (req == REQ_FILE && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
        }
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String s = u.getScheme();
            if ("file".equals(s) && u.toString().startsWith(START)) return false;
            if (("http".equals(s) || "https".equals(s)) && trusted(Hosts.originOf(u.toString()))) return false;
            // anything else (a link in a reply, UU 远程, an app store) opens outside the App
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException e) {
                toast("没有能打开它的应用");
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            // Back never returns to an older computer or the pairing page; it may return from a wrong code to the start page
            if (clearHistory && url != null && !"/pair".equals(Uri.parse(url).getPath())) {
                clearHistory = false;
                v.clearHistory();
            }
            ready = url != null && !url.startsWith("file:");
            deliver();
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
            if (!r.isForMainFrame() || r.getUrl().toString().startsWith("file:")) return;
            // the computer is off, asleep or on another network
            Hosts.Host h = saved.current();
            String origin = Hosts.originOf(r.getUrl().toString());
            home(h != null && h.origin.equals(origin) ? h.name + "|" + origin.replaceFirst("^https?://", "") : origin == null ? "" : "|" + origin.replaceFirst("^https?://", ""));
        }
    }

    private final class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            try {
                startActivityForResult(p.createIntent(), REQ_FILE);
            } catch (ActivityNotFoundException e) {
                fileCb = null;
                return false;
            }
            return true;
        }
    }

    /** window.XiaotianNative. Called on a background thread; anything that touches the WebView goes to the UI thread. */
    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public boolean uuInstalled() {
            return canOpen(Uri.parse("uuremote://external/device/authorize"));
        }

        /** opens a web page in the browser, UU 远程 (uuremote://) or an app store (market://); false when nothing can */
        @JavascriptInterface
        public boolean openUrl(String url) {
            Uri u = Uri.parse(url == null ? "" : url);
            String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            if (s.equals("http") || s.equals("https")) i.addCategory(Intent.CATEGORY_BROWSABLE);
            else if (!(s.equals("uuremote") || s.equals("market")) || !canOpen(u)) return false;
            runOnUiThread(() -> {
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    toast("没有能打开它的应用");
                }
            });
            return true;
        }

        /** the page is signed in to its computer: keep it in the list, and open it next time */
        @JavascriptInterface
        public void paired(String origin, String token, String name) {
            runOnUiThread(() -> {
                if (origin == null || token == null || token.isEmpty() || !origin.equals(Hosts.originOf(web.getUrl()))) return;
                saved.save(origin, token, name == null || name.trim().isEmpty() ? origin.replaceFirst("^https?://", "") : name.trim());
            });
        }

        @JavascriptInterface
        public String hosts() {
            return saved.json();
        }

        @JavascriptInterface
        public void switchHost(String id) {
            runOnUiThread(() -> {
                Hosts.Host h = saved.pick(id == null ? "" : id);
                if (h != null) open(h);
            });
        }

        @JavascriptInterface
        public void scan() {
            runOnUiThread(() -> startActivityForResult(new Intent(MainActivity.this, ScanActivity.class), REQ_SCAN));
        }

        /** the start page's typed address and code */
        @JavascriptInterface
        public void connect(String url) {
            runOnUiThread(() -> pair(url));
        }

        /** this computer unpaired the phone: drop it and go back to the start page */
        @JavascriptInterface
        public void forget() {
            runOnUiThread(() -> {
                Hosts.Host h = saved.current();
                if (h != null) saved.forget(h.id);
                MainActivity.this.home(null);
            });
        }

        @JavascriptInterface
        public void forgetHost(String id) {
            runOnUiThread(() -> saved.forget(id == null ? "" : id));
        }

        @JavascriptInterface
        public void home() {
            runOnUiThread(() -> MainActivity.this.home(null));
        }

        /** the page's background and whether it is light, for the status and navigation bars */
        @JavascriptInterface
        public void bars(String color, boolean light) {
            runOnUiThread(() -> MainActivity.this.bars(color, light));
        }
    }
}
