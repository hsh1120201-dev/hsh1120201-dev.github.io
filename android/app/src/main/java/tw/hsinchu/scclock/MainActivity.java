package tw.hsinchu.scclock;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// 打卡 App：開啟網站的打卡頁（/clock/），功能都在網頁上，網站更新 App 就跟著更新
public class MainActivity extends Activity {
    static final String HOME = "https://hsh1120201-dev.github.io/clock/";
    WebView web;
    GeolocationPermissions.Callback geoCb;
    String geoOrigin;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(Color.parseColor("#F9B72F"));
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " SCClockApp/1.0");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String h = u.getHost() == null ? "" : u.getHost();
                if (h.equals("hsh1120201-dev.github.io")) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
                if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                    geoCb = cb; geoOrigin = origin;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
                } else cb.invoke(origin, true, false);
            }
        });
        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] p, int[] r) {
        boolean ok = r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED;
        if (geoCb != null) { geoCb.invoke(geoOrigin, ok, false); geoCb = null; }
    }

    @Override
    protected void onSaveInstanceState(Bundle b) { super.onSaveInstanceState(b); web.saveState(b); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
