import { Activity, useCallback, useEffect, useState } from 'react';
import { BottomNav, TABS, type Tab } from './components/BottomNav';
import { SettingsSheet } from './components/SettingsSheet';
import { IconSettings } from './components/Icons';
import { DemoBadge } from './components/ui';
import { HOSPITAL_NAME } from './lib/config';
import { usePrefs } from './lib/prefs';
import { useAuth } from './lib/session';
import { Login } from './pages/Login';
import { AssistantPage } from './pages/Assistant';
import { IndicatorsPage } from './pages/Indicators';
import { DataPage } from './pages/Data';
import { FillPage } from './pages/Fill';
import { ExportPage } from './pages/Export';
import { useOnline } from './lib/online';
import { Notice } from './components/ui';
import { useApp } from './lib/appState';

function tabFromHash(): Tab {
  const h = location.hash.replace('#/', '') as Tab;
  return TABS.some((t) => t.id === h) ? h : 'assistant';
}

export function App() {
  const demo = usePrefs((p) => p.demoMode);
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [settings, setSettings] = useState(false);
  const online = useOnline();
  const exportDraft = useApp((s) => s.exportDraft);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const go = useCallback((t: Tab) => {
    setTab(t);
    history.replaceState(null, '', t === 'assistant' ? location.pathname : `#/${t}`);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => { if (exportDraft) go('export'); }, [exportDraft, go]);

  if (!demo) {
    if (auth.status === 'loading') return <div className="login" aria-busy="true"><span className="faint">جارٍ التحميل…</span></div>;
    if (auth.status === 'signed_out') return <Login />;
    if (auth.status === 'not_owner') return <Login notOwner={auth.email} />;
  }

  return (
    <div className="shell">
      <header className="topbar glass" style={{ borderRadius: 0, borderInline: 0, borderTop: 0 }}>
        <button type="button" className="icon-btn" aria-label="الإعدادات" onClick={() => setSettings(true)}>
          <IconSettings aria-hidden />
        </button>
        <div className="topbar__title"><strong>{HOSPITAL_NAME}</strong>قسم الإحصاء الطبي</div>
        <div className="topbar__mode">{demo ? <DemoBadge /> : null}</div>
      </header>
      {!online && <div className="page" style={{ paddingBottom: 0 }}><Notice tone="warn">لا يوجد اتصال بالإنترنت. النتائج المعروضة محفوظة من قبل، ولا يمكن حساب أسئلة جديدة الآن.</Notice></div>}
      <Activity mode={tab === 'fill' ? 'visible' : 'hidden'}><FillPage /></Activity>
      <Activity mode={tab === 'data' ? 'visible' : 'hidden'}><DataPage /></Activity>
      <Activity mode={tab === 'assistant' ? 'visible' : 'hidden'}><AssistantPage onOpenIndicators={() => go('indicators')} onExport={() => go('export')} /></Activity>
      <Activity mode={tab === 'indicators' ? 'visible' : 'hidden'}><IndicatorsPage active={tab === 'indicators'} /></Activity>
      <Activity mode={tab === 'export' ? 'visible' : 'hidden'}><ExportPage /></Activity>
      <BottomNav tab={tab} onChange={go} />
      <SettingsSheet open={settings} onOpenChange={setSettings} signedIn={auth.status === 'ready'} />
    </div>
  );
}
