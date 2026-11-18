import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { setPrefs } from '../lib/prefs';
import { HOSPITAL_NAME, USER_NAME } from '../lib/config';
import { Notice } from '../components/ui';
import { IconDemo, IconLock } from '../components/Icons';

export function Login({ notOwner }: { notOwner?: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message.includes('Invalid') ? 'البريد أو كلمة المرور غير صحيحة.' : 'تعذّر تسجيل الدخول. تحققي من الاتصال بالإنترنت.');
  };

  return (
    <main className="login">
      <div className="login__card glass">
        <IconLock aria-hidden style={{ width: 22, height: 22, color: 'var(--accent)' }} />
        <h1>أهلًا {USER_NAME}</h1>
        <p className="muted" style={{ margin: 0 }}>{HOSPITAL_NAME} — تطبيق خاص بحساب واحد.</p>
        {notOwner !== undefined && (
          <div style={{ marginTop: 16 }}>
            <Notice tone="danger">
              هذا الحساب{notOwner ? <> (<bdi>{notOwner}</bdi>)</> : null} غير مصرح له بالوصول إلى بيانات القسم.
              <div style={{ marginTop: 8 }}><button className="btn btn--sm" type="button" onClick={() => supabase().auth.signOut()}>تسجيل الخروج</button></div>
            </Notice>
          </div>
        )}
        <form onSubmit={submit}>
          <label className="field"><span>البريد الإلكتروني</span>
            <input className="input" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field"><span>كلمة المرور</span>
            <input className="input" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'دخول'}</button>
        </form>
        <button type="button" className="btn btn--ghost" style={{ marginTop: 12, width: '100%' }} onClick={() => setPrefs({ demoMode: true })}>
          <IconDemo aria-hidden />عرض تجريبي بلا بيانات حقيقية
        </button>
      </div>
    </main>
  );
}
