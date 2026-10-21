package com.xiaotianbot.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;
import android.view.animation.LinearInterpolator;

/** The scanner's frame: the camera image dimmed outside a centred square, white corners, and a line sweeping down. */
public class ScanFrame extends View {
    private final Paint dim = new Paint(), corner = new Paint(Paint.ANTI_ALIAS_FLAG), line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF box = new RectF();
    private final Path shade = new Path(), corners = new Path();
    private float sweep;
    private ValueAnimator anim;

    public ScanFrame(Context c, AttributeSet a) {
        super(c, a);
        dim.setColor(0x99000000);
        corner.setColor(0xFFF2F2F3);
        corner.setStyle(Paint.Style.STROKE);
        corner.setStrokeWidth(dp(4));
        corner.setStrokeCap(Paint.Cap.ROUND);
    }

    private float dp(float v) {
        return v * getResources().getDisplayMetrics().density;
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        float s = dp(248);
        box.set((w - s) / 2f, (h - s) / 2f, (w + s) / 2f, (h + s) / 2f);
        shade.reset();
        shade.setFillType(Path.FillType.EVEN_ODD);
        shade.addRect(0, 0, w, h, Path.Direction.CW);
        shade.addRoundRect(box, dp(18), dp(18), Path.Direction.CW);
        float r = dp(18), L = dp(30);
        corners.reset();
        // four brackets that follow the rounded corners
        corners.moveTo(box.left, box.top + L); corners.lineTo(box.left, box.top + r); corners.quadTo(box.left, box.top, box.left + r, box.top); corners.lineTo(box.left + L, box.top);
        corners.moveTo(box.right - L, box.top); corners.lineTo(box.right - r, box.top); corners.quadTo(box.right, box.top, box.right, box.top + r); corners.lineTo(box.right, box.top + L);
        corners.moveTo(box.right, box.bottom - L); corners.lineTo(box.right, box.bottom - r); corners.quadTo(box.right, box.bottom, box.right - r, box.bottom); corners.lineTo(box.right - L, box.bottom);
        corners.moveTo(box.left + L, box.bottom); corners.lineTo(box.left + r, box.bottom); corners.quadTo(box.left, box.bottom, box.left, box.bottom - r); corners.lineTo(box.left, box.bottom - L);
        line.setShader(new LinearGradient(box.left, 0, box.right, 0, new int[]{0x008B7BFF, 0xFF8B7BFF, 0x008B7BFF}, null, Shader.TileMode.CLAMP));
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        anim = ValueAnimator.ofFloat(0f, 1f);
        anim.setDuration(2200);
        anim.setRepeatCount(ValueAnimator.INFINITE);
        anim.setInterpolator(new LinearInterpolator());
        anim.addUpdateListener(a -> {
            sweep = (float) a.getAnimatedValue();
            invalidate();
        });
        anim.start();
    }

    @Override
    protected void onDetachedFromWindow() {
        if (anim != null) anim.cancel();
        super.onDetachedFromWindow();
    }

    @Override
    protected void onDraw(Canvas c) {
        c.drawPath(shade, dim);
        c.drawPath(corners, corner);
        float y = box.top + dp(12) + (box.height() - dp(24)) * sweep;
        c.drawRect(box.left + dp(14), y - dp(1), box.right - dp(14), y + dp(1), line);
    }
}
