import { useRef, useEffect, useCallback } from 'react';

/**
 * A signature box the customer draws in with a finger, stylus or mouse (spec 51, gap 1).
 *
 * The result is a PNG that goes onto white paper in the PDF, so the pad is always drawn as dark
 * ink on a light box, whatever the app theme is. (A theme colour here would make the signature
 * invisible on the PDF in dark mode.) That is the one place this app uses fixed colours.
 */
const INK = '#111111';
const PAPER = '#ffffff';

interface Props {
  /** Called with a PNG data URL after each stroke, or null when the pad is empty. */
  onChange: (png: string | null) => void;
  label: string;
  clearLabel?: string;
  disabled?: boolean;
  hasError?: boolean;
}

export function SignaturePad({ onChange, label, clearLabel = 'Clear', disabled, hasError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Size the canvas to its box at the device's pixel density, so the line stays sharp.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    inked.current = false;
    onChangeRef.current(null);
  }, []);

  useEffect(() => {
    resize();
    // Rotating a tablet resizes the box; the drawing is cleared rather than distorted.
    window.addEventListener('orientationchange', resize);
    return () => window.removeEventListener('orientationchange', resize);
  }, [resize]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    // A tap leaves a dot.
    const ctx = e.currentTarget.getContext('2d');
    if (ctx && last.current) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(last.current.x + 0.01, last.current.y + 0.01);
      ctx.stroke();
      inked.current = true;
    }
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    inked.current = true;
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (inked.current) onChangeRef.current(e.currentTarget.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    inked.current = false;
    onChangeRef.current(null);
  };

  return (
    <div style={s.wrap}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        style={{ ...s.canvas, borderColor: hasError ? 'var(--color-error)' : 'var(--color-border)', opacity: disabled ? 0.6 : 1 }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button type="button" onClick={clear} disabled={disabled} style={s.clear}>{clearLabel}</button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' },
  // touch-action none stops the page scrolling while the customer signs.
  canvas: { width: '100%', maxWidth: '520px', height: '160px', background: PAPER, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', touchAction: 'none', cursor: 'crosshair' },
  clear: { background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md, 8px)', color: 'var(--color-text)', padding: '8px 16px', minHeight: '44px', fontSize: 'var(--font-size-sm)', cursor: 'pointer', fontFamily: 'var(--font-family)' },
};
