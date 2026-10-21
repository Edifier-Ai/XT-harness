package com.xiaotianbot.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.view.WindowInsets;
import android.widget.TextView;

import com.google.zxing.BarcodeFormat;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;
import com.journeyapps.barcodescanner.DefaultDecoderFactory;

import java.util.Collections;

/** Scans the pairing QR code the computer shows (小天 Bot › 设置 › 手机). Returns its text, or manual=true to type it in. */
public class ScanActivity extends Activity {
    private static final int REQ_CAMERA = 1;
    private DecoratedBarcodeView scanner;
    private TextView hint, allow;
    private boolean asked;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.scan);
        scanner = findViewById(R.id.scanner);
        hint = findViewById(R.id.hint);
        allow = findViewById(R.id.allow);
        scanner.getBarcodeView().setDecoderFactory(new DefaultDecoderFactory(Collections.singletonList(BarcodeFormat.QR_CODE)));
        scanner.setStatusText("");
        scanner.decodeSingle(r -> {
            setResult(RESULT_OK, new Intent().putExtra("text", r.getText()));
            finish();
        });
        findViewById(R.id.close).setOnClickListener(v -> finish());
        findViewById(R.id.manual).setOnClickListener(v -> {
            setResult(RESULT_OK, new Intent().putExtra("manual", true));
            finish();
        });
        allow.setOnClickListener(v -> {
            if (shouldShowRequestPermissionRationale(Manifest.permission.CAMERA) || !asked) requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
            else startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getPackageName(), null)));
        });
        View top = findViewById(R.id.top), bottom = findViewById(R.id.bottom);
        int t = top.getPaddingTop(), b = bottom.getPaddingBottom();
        findViewById(R.id.root).setOnApplyWindowInsetsListener((v, insets) -> {
            int it, ib;
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                it = i.top;
                ib = i.bottom;
            } else {
                it = insets.getSystemWindowInsetTop();
                ib = insets.getSystemWindowInsetBottom();
            }
            top.setPadding(top.getPaddingLeft(), t + it, top.getPaddingRight(), top.getPaddingBottom());
            bottom.setPadding(bottom.getPaddingLeft(), bottom.getPaddingTop(), bottom.getPaddingRight(), b + ib);
            return insets;
        });
    }

    private boolean hasCamera() {
        return checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasCamera()) {
            allow.setVisibility(View.GONE);
            hint.setText(R.string.scan_hint);
            scanner.resume();
        } else if (!asked) {
            asked = true;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        } else {
            noCamera();
        }
    }

    private void noCamera() {
        hint.setText(R.string.scan_no_camera);
        allow.setVisibility(View.VISIBLE);
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        super.onRequestPermissionsResult(req, perms, res);
        if (req != REQ_CAMERA) return;
        if (hasCamera()) {
            allow.setVisibility(View.GONE);
            hint.setText(R.string.scan_hint);
            scanner.resume();
        } else noCamera();
    }

    @Override
    protected void onPause() {
        super.onPause();
        scanner.pause();
    }
}
