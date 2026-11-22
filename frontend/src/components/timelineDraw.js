import { PAD, spanBox, xForBin, withAlpha } from '../utils/timelineModel.js';

// Canvas drawing for the audio timeline. Pure of React: everything it needs arrives in one argument, and every colour
// comes from the CSS tokens (read by the component), so theming stays in the token layer.
//
// Layers, back to front: reference grid, sample spans (tinted + hatched + a top bar), the loudness ribbon
// (mirrored about the centre line), Beat Pulse (dashed) and Grit (solid) rising from the baseline, the cursor, time ticks.
// Every curve and span is encoded twice (colour AND stroke / hatch) so the chart reads under colour-vision deficiency.

function trace(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const xc = (pts[i][0] + pts[i + 1][0]) / 2;
    const yc = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

// A curve with a surface-coloured halo beneath it, so two lines crossing stay separable.
function curve(ctx, pts, { colour, halo, dashed }) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.strokeStyle = halo;
  ctx.lineWidth = 4.5;
  trace(ctx, pts);
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.2;
  trace(ctx, pts);
  ctx.stroke();
  ctx.restore();
}

export function drawTimeline(ctx, {
  width, height, timeline: tl, samples, activeSampleItem, showGrit, showPulse, activeBin, colours: c,
}) {
  const n = tl.bins;
  const plotW = width - PAD.l - PAD.r;
  const plotH = height - PAD.t - PAD.b;
  const midY = PAD.t + plotH / 2;
  const halfMax = plotH * 0.44;
  const binW = plotW / n;

  ctx.clearRect(0, 0, width, height);

  // Quarter lines.
  ctx.save();
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  for (const f of [0.25, 0.5, 0.75]) {
    const y = Math.round(PAD.t + plotH * (1 - f)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(width - PAD.r, y);
    ctx.stroke();
  }
  ctx.restore();

  // Approved sample clips: tinted band + diagonal hatch + a solid top bar. The clip under the cursor is stronger.
  for (const s of samples) {
    const { x1, x2 } = spanBox(s, tl, width);
    const on = s === activeSampleItem;
    ctx.save();
    ctx.fillStyle = withAlpha(c.sample, on ? 0.26 : 0.14);
    ctx.fillRect(x1, PAD.t, x2 - x1, plotH);
    ctx.beginPath();
    ctx.rect(x1, PAD.t, x2 - x1, plotH);
    ctx.clip();
    ctx.strokeStyle = withAlpha(c.sample, on ? 0.42 : 0.26);
    ctx.lineWidth = 1.2;
    for (let hx = x1 - plotH; hx < x2 + plotH; hx += 8) {
      ctx.beginPath();
      ctx.moveTo(hx, PAD.t + plotH);
      ctx.lineTo(hx + plotH * 0.65, PAD.t);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = c.sample;
    ctx.fillRect(x1, PAD.t, x2 - x1, 4);
  }

  // Loudness ribbon, mirrored about the centre line.
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + plotH);
  grad.addColorStop(0, withAlpha(c.ribbon, 0.34));
  grad.addColorStop(0.5, withAlpha(c.ribbon, 0.22));
  grad.addColorStop(1, withAlpha(c.ribbon, 0.34));
  const amp = (i) => Math.max(1.5, tl.loudness[i] * halfMax);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(PAD.l, midY - amp(0));
  for (let i = 0; i < n; i++) ctx.lineTo(PAD.l + (i + 0.5) * binW, midY - amp(i));
  ctx.lineTo(width - PAD.r, midY - amp(n - 1));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(PAD.l + (i + 0.5) * binW, midY + amp(i));
  ctx.lineTo(PAD.l, midY + amp(0));
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = withAlpha(c.ribbon, 0.6);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Beat Pulse (dashed) under Grit (solid), both from the baseline up.
  const pts = (arr) => arr.map((v, i) => [PAD.l + (i + 0.5) * binW, PAD.t + plotH * (1 - v * 0.94) - 2]);
  if (showPulse) curve(ctx, pts(tl.pulse), { colour: c.pulse, halo: c.surface, dashed: true });
  if (showGrit) curve(ctx, pts(tl.grit), { colour: c.grit, halo: c.surface, dashed: false });

  // Cursor.
  const cx = xForBin(activeBin, width, n);
  ctx.save();
  ctx.strokeStyle = c.cursor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(cx, PAD.t);
  ctx.lineTo(cx, PAD.t + plotH);
  ctx.stroke();
  ctx.fillStyle = c.cursor;
  ctx.beginPath();
  ctx.arc(cx, PAD.t + 4, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Time ticks: start, middle, end.
  ctx.save();
  ctx.fillStyle = c.text;
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  const ty = PAD.t + plotH + 5;
  ctx.textAlign = 'left';
  ctx.fillText(c.fmt(0), PAD.l, ty);
  ctx.textAlign = 'center';
  ctx.fillText(c.fmt(tl.duration_sec / 2), PAD.l + plotW / 2, ty);
  ctx.textAlign = 'right';
  ctx.fillText(c.fmt(tl.duration_sec), width - PAD.r, ty);
  ctx.restore();
}
