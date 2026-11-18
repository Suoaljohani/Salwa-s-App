import { type ReactNode } from 'react';
import { IconAlert, IconDemo, IconInfo, IconOk, IconWarn } from './Icons';
import { fmtNum } from '../lib/format';

export function Num({ value, className }: { value: number | null | undefined; className?: string }) {
  return <bdi className={`num ${className ?? ''}`}>{fmtNum(value)}</bdi>;
}

/** "492 زيارة": the number is isolated; the unit follows it in the Arabic reading order. */
export function Count({ value, unit }: { value: number; unit: string }) {
  return <span><bdi className="num">{fmtNum(value)}</bdi> {unit}</span>;
}

export function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'none' | 'demo' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'ok' ? IconOk : tone === 'warn' ? IconWarn : tone === 'none' || tone === 'danger' ? IconAlert : tone === 'demo' ? IconDemo : null;
  return <span className={`pill pill--${tone}`}>{Icon && <Icon aria-hidden />}{children}</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  const Icon = tone === 'warn' ? IconWarn : tone === 'danger' ? IconAlert : IconInfo;
  return (
    <div className={`notice notice--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  );
}

export function DemoBadge() {
  return <Pill tone="demo">بيانات تجريبية</Pill>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
