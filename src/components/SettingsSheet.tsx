import { Switch } from '@base-ui/react/switch';
import { Fragment, useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { Seg, Pill } from './ui';
import { setPrefs, usePrefs, type Prefs } from '../lib/prefs';
import { cue, unlockSound } from '../lib/sound';
import { supabase } from '../lib/supabase';
import { getCatalog } from '../lib/metrics/engine';
import { fmtBytes, fmtNum } from '../lib/format';
import { HOSPITAL_NAME, USER_FULL_NAME, USER_TITLE } from '../lib/config';
import { IconLogout, IconRetry } from './Icons';
import type { Catalog } from '../lib/metrics/types';

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting">
      <span>{label}{hint && <small>{hint}</small>}</span>
      <Switch.Root className="switch" checked={checked} onCheckedChange={(v) => onChange(v)}>
        <Switch.Thumb className="switch__thumb" />
      </Switch.Root>
    </label>
  );
}

type Conn = { state: 'idle' | 'checking' | 'ok' | 'error'; catalog?: Catalog; ai?: string; message?: string };

export function SettingsSheet({ open, onOpenChange, signedIn }: { open: boolean; onOpenChange: (o: boolean) => void; signedIn: boolean }) {
  const p = usePrefs((x) => x);
  const [conn, setConn] = useState<Conn>({ state: 'idle' });
  const set = (patch: Partial<Prefs>) => setPrefs(patch);

  const check = async () => {
    setConn({ state: 'checking' });
    try {
      const catalog = await getCatalog(true);
      let ai = 'غير مستخدم في الوضع التجريبي';
      if (!p.demoMode) {
        const { data, error } = await supabase().functions.invoke('assistant', { body: { question: '__health' } });
        const h = data as { kind?: string; ai_configured?: boolean; model?: string } | null;
        ai = error || h?.kind !== 'health' ? 'تعذّر الوصول إلى الخدمة' : h.ai_configured ? `جاهز (Groq — ${h.model})` : 'مفتاح Groq غير مضبوط في الخادم بعد';
      }
      setConn({ state: 'ok', catalog, ai });
    } catch (e) {
      setConn({ state: 'error', message: (e as Error).message });
    }
  };
  useEffect(() => { if (open && conn.state === 'idle') void check(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="الإعدادات">
      <div className="settings-group">
        <strong>{USER_FULL_NAME}</strong>
        <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{USER_TITLE} — {HOSPITAL_NAME}</div>
      </div>

      <div className="settings-group">
        <h3>المظهر</h3>
        <div className="setting">
          <span>السمة</span>
          <Seg label="السمة" value={p.theme} onChange={(theme) => set({ theme })}
            options={[{ value: 'system', label: 'تلقائي' }, { value: 'light', label: 'فاتح' }, { value: 'dark', label: 'داكن' }]} />
        </div>
        <div className="setting">
          <span>الأرقام</span>
          <Seg label="شكل الأرقام" value={p.digits} onChange={(digits) => set({ digits })}
            options={[{ value: 'latn', label: '123' }, { value: 'arab', label: '١٢٣' }]} />
        </div>
        <label className="field slider">
          <span>حجم الخط: <bdi className="num">{fmtNum(Math.round(p.fontScale * 100))}٪</bdi></span>
          <input type="range" min={0.9} max={1.4} step={0.05} value={p.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} />
        </label>
        <Toggle label="تقليل الحركة" hint="يعرض الرسوم في حالتها النهائية مباشرة" checked={p.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
        <Toggle label="تقليل الشفافية" hint="أسطح مصمتة بدل الزجاج" checked={p.reduceTransparency} onChange={(reduceTransparency) => set({ reduceTransparency })} />
      </div>

      <div className="settings-group">
        <h3>الصوت</h3>
        <Toggle
          label="أصوات التأكيد"
          hint="نغمات قصيرة عند اكتمال الاستيراد أو جاهزية الملف فقط"
          checked={p.soundEnabled}
          onChange={async (soundEnabled) => {
            set({ soundEnabled });
            if (soundEnabled && (await unlockSound())) cue('success');
          }}
        />
        <label className="field slider" aria-disabled={!p.soundEnabled}>
          <span>مستوى الصوت</span>
          <input type="range" min={0} max={1} step={0.05} value={p.soundVolume} disabled={!p.soundEnabled}
            onChange={(e) => set({ soundVolume: Number(e.target.value) })} />
        </label>
        <div className="row">
          {(['success', 'complete', 'notice'] as const).map((c) => (
            <button key={c} type="button" className="btn btn--sm" disabled={!p.soundEnabled}
              onClick={async () => { if (await unlockSound()) cue(c); }}>
              معاينة: {c === 'success' ? 'نجاح الاستيراد' : c === 'complete' ? 'جاهزية الملف' : 'تنبيه'}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <h3>الإجابات</h3>
        <div className="setting">
          <span>طول الإجابة</span>
          <Seg label="طول الإجابة" value={p.answerDetail} onChange={(answerDetail) => set({ answerDetail })}
            options={[{ value: 'brief', label: 'مختصرة' }, { value: 'detailed', label: 'مفصلة' }]} />
        </div>
        <Toggle label="إظهار المصدر والتغطية" checked={p.showSources} onChange={(showSources) => set({ showSources })} />
      </div>

      <div className="settings-group">
        <h3>البيانات والاتصال</h3>
        <Toggle label="الوضع التجريبي" hint="بيانات مولّدة للعرض فقط، منفصلة تمامًا عن بيانات المستشفى" checked={p.demoMode}
          onChange={(demoMode) => { set({ demoMode }); setConn({ state: 'idle' }); }} />
        <div className="row row--between" style={{ marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>حالة الاتصال</span>
          <button type="button" className="btn btn--sm btn--quiet" onClick={check}><IconRetry aria-hidden />فحص</button>
        </div>
        {conn.state === 'checking' && <p className="faint">جارٍ الفحص…</p>}
        {conn.state === 'error' && <p><Pill tone="danger">تعذّر الاتصال بقاعدة البيانات</Pill></p>}
        {conn.state === 'ok' && conn.catalog && (
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>قاعدة البيانات</dt><dd>{p.demoMode ? 'تجريبية محلية' : 'متصلة'}</dd>
            <dt>الفهم الذكي</dt><dd>{conn.ai}</dd>
            {conn.catalog.datasets.map((d) => <Fragment key={d.id}><dt>{d.name}</dt><dd><bdi className="num">{fmtNum(d.row_count)}</bdi> {d.unit_label}</dd></Fragment>)}
            {conn.catalog.database_bytes != null && <><dt>حجم قاعدة البيانات</dt><dd>{fmtBytes(conn.catalog.database_bytes)} من 500 م.ب المجانية</dd></>}
            {conn.catalog.storage_bytes != null && <><dt>الملفات المحفوظة</dt><dd>{fmtBytes(conn.catalog.storage_bytes)} من 1 ج.ب المجانية</dd></>}
          </dl>
        )}
      </div>

      {signedIn && !p.demoMode && (
        <div className="settings-group">
          <button type="button" className="btn btn--danger" onClick={() => supabase().auth.signOut()}>
            <IconLogout aria-hidden />تسجيل الخروج
          </button>
        </div>
      )}
    </Sheet>
  );
}
