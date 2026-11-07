import { useRef } from 'react';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Valor ao dar duplo clique (centro). */
  center?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  color?: string;
  size?: number;
  coach?: string;
  bipolar?: boolean;
  title?: string;
}

/** Knob: arraste para cima/baixo, roda do mouse, setas do teclado; duplo clique volta ao centro. */
export function Knob({ label, value, min, max, center = (min + max) / 2, onChange, format, color = 'var(--accent)', size = 52, coach, bipolar = true, title }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const span = max - min;
  const norm = (value - min) / span;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  // Ímã no centro: facilita voltar ao neutro.
  const snap = (v: number) => (Math.abs(v - center) < span * 0.025 ? center : v);

  const angle = -135 + norm * 270;
  const r = size / 2 - 5;
  const c = size / 2;
  const arc = (from: number, to: number) => {
    const p = (a: number) => [c + r * Math.sin((a * Math.PI) / 180), c - r * Math.cos((a * Math.PI) / 180)];
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    const large = Math.abs(to - from) > 180 ? 1 : 0;
    const sweep = to > from ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} ${sweep} ${x2} ${y2}`;
  };
  const centerAngle = bipolar ? -135 + ((center - min) / span) * 270 : -135;

  return (
    <div className="knob" data-coach={coach} title={title}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuetext={format ? format(value) : String(value)}
        className="knob-dial"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const fine = e.shiftKey ? 0.25 : 1;
          onChange(snap(clamp(drag.current.v + ((drag.current.y - e.clientY) / 160) * span * fine)));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(center)}
        onWheel={(e) => onChange(snap(clamp(value - Math.sign(e.deltaY) * span * 0.03)))}
        onKeyDown={(e) => {
          const step = span * (e.shiftKey ? 0.01 : 0.05);
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(clamp(value + step));
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(clamp(value - step));
          else if (e.key === 'Home' || e.key === '0') onChange(center);
          else return;
          e.preventDefault();
        }}
      >
        <svg width={size} height={size} aria-hidden>
          <path d={arc(-135, 135)} className="knob-track" />
          {Math.abs(angle - centerAngle) > 0.5 && (
            <path d={arc(Math.min(angle, centerAngle), Math.max(angle, centerAngle))} stroke={color} className="knob-value" />
          )}
          <line
            x1={c}
            y1={c}
            x2={c + (r - 6) * Math.sin((angle * Math.PI) / 180)}
            y2={c - (r - 6) * Math.cos((angle * Math.PI) / 180)}
            className="knob-pointer"
          />
        </svg>
      </div>
      <span className="knob-label">{label}</span>
      <span className="knob-readout">{format ? format(value) : value.toFixed(1)}</span>
    </div>
  );
}
