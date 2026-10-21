package com.xiaotianbot.fakeuu;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

/**
 * device/authorize: answers at once with a made-up anonymous_device_id (or error=no_device when the nonce is "nodevice").
 * device/control: full screen shows a stand-in "remote desktop" until Back; small window answers status=success and closes.
 */
public class FakeUU extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handle(i);
    }

    private void handle(Intent i) {
        Uri u = i.getData();
        if (u == null) {
            finish();
            return;
        }
        String cb = u.getQueryParameter("callback");
        if ("/device/authorize".equals(u.getPath())) {
            String nonce = u.getQueryParameter("nonce");
            answer(cb, "nodevice".equals(nonce) ? "error=no_device&nonce=" + nonce : "anonymous_device_id=fake-pc-1&nonce=" + nonce);
            finish();
        } else if ("/device/control".equals(u.getPath())) {
            if ("1".equals(u.getQueryParameter("window_type"))) {
                answer(cb, "fake-pc-1".equals(u.getQueryParameter("anonymous_device_id")) ? "status=success" : "status=failure&reason=device_not_found");
                finish();
                return;
            }
            TextView t = new TextView(this);
            t.setText("UU 远程（测试替身）\n正在全屏控制 " + u.getQueryParameter("anonymous_device_id") + "\n\n按返回键结束");
            t.setTextColor(Color.WHITE);
            t.setTextSize(20);
            t.setGravity(Gravity.CENTER);
            t.setBackgroundColor(0xFF1E5AA8);
            t.setContentDescription("fake-uu-full");
            setContentView(t);
        } else finish();
    }

    private void answer(String cb, String query) {
        if (cb == null) return;
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(cb + (cb.contains("?") ? "&" : "?") + query)));
    }
}
