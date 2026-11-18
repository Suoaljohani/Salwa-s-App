import { IconAssistant, IconData, IconExport, IconFill, IconIndicators } from './Icons';

export type Tab = 'fill' | 'data' | 'assistant' | 'indicators' | 'export';

// DOM order = physical order in RTL: first item sits at the far right.
export const TABS: { id: Tab; label: string; Icon: typeof IconFill }[] = [
  { id: 'fill', label: 'تعبئة', Icon: IconFill },
  { id: 'data', label: 'البيانات', Icon: IconData },
  { id: 'assistant', label: 'المساعد', Icon: IconAssistant },
  { id: 'indicators', label: 'المؤشرات', Icon: IconIndicators },
  { id: 'export', label: 'استخراج', Icon: IconExport },
];

export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <nav className="nav glass" aria-label="التنقل الرئيسي">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`nav__item${id === 'assistant' ? ' nav__item--center' : ''}`}
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => onChange(id)}
        >
          <Icon aria-hidden />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
