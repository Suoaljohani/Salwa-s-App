import { useRef, useState, type DragEvent } from 'react';
import { IconSpinner, IconUpload } from './Icons';

export function FileDrop({ accept, onFile, title, hint, busy }: { accept: string; onFile: (f: File) => void; title: string; hint?: string; busy?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  };
  return (
    <>
      <button
        type="button" className="drop" data-over={over} disabled={busy} style={{ width: '100%' }}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {busy ? <IconSpinner aria-hidden className="spin" /> : <IconUpload aria-hidden />}
        <strong>{busy ? 'جارٍ قراءة الملف…' : title}</strong>
        {hint && <span style={{ fontSize: 'var(--fs-xs)' }}>{hint}</span>}
      </button>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </>
  );
}
