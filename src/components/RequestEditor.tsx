import type { DataCatalog, Dimension, MetricFilters, MetricRequest } from '../lib/metrics/types';
import { DIMENSIONS, DIMENSION_ORDER, valueLabel } from '../lib/metrics/catalog';
import { Seg } from './ui';

/** Structured editor for one metric request. Shared by Export and Fill so both use the same contract. */
export function RequestEditor({ value, onChange, catalog, showGroups = true, showPeriod = true }: {
  value: MetricRequest; onChange: (r: MetricRequest) => void; catalog: DataCatalog | null; showGroups?: boolean; showPeriod?: boolean;
}) {
  const f = value.filters;
  const setF = (patch: Partial<MetricFilters>) => {
    const next = { ...f, ...patch } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || (Array.isArray(next[k]) && (next[k] as unknown[]).length === 0)) delete next[k];
    onChange({ ...value, filters: next as MetricFilters });
  };
  const num = (s: string) => (s.trim() === '' ? undefined : Math.max(0, Math.min(130, Math.round(Number(s)))));
  const depts = catalog?.values.department ?? [];

  return (
    <div className="stack">
      <div className="row">
        <Seg label="وحدة العد" value={value.metric} onChange={(metric) => onChange({ ...value, metric })}
          options={[{ value: 'visits', label: 'زيارات' }, { value: 'distinct_patients', label: 'مرضى مختلفون' }]} />
        <Seg label="نوع الزيارة" value={f.encounter_type?.[0] ?? 'all'} onChange={(v) => setF({ encounter_type: v === 'all' ? undefined : [v] })}
          options={[{ value: 'all', label: 'الكل' }, { value: 'Emergency', label: 'الطوارئ' }, { value: 'Outpatient', label: 'العيادات' }]} />
      </div>
      {showPeriod && (
        <div className="row">
          <label className="field"><span>من (شامل)</span><input className="input" type="date" dir="ltr" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} /></label>
          <label className="field"><span>إلى (غير شامل)</span><input className="input" type="date" dir="ltr" value={value.end_exclusive} onChange={(e) => onChange({ ...value, end_exclusive: e.target.value })} /></label>
        </div>
      )}
      <div className="row">
        <label className="field" style={{ flex: '1 1 120px' }}><span>العمر من (شامل)</span>
          <input className="input" inputMode="numeric" dir="ltr" value={f.age_min ?? ''} onChange={(e) => setF({ age_min: num(e.target.value) })} /></label>
        <label className="field" style={{ flex: '1 1 120px' }}><span>إلى أقل من</span>
          <input className="input" inputMode="numeric" dir="ltr" value={f.age_max_exclusive ?? ''} onChange={(e) => setF({ age_max_exclusive: num(e.target.value) })} /></label>
        <label className="field" style={{ flex: '1 1 120px' }}><span>الجنس</span>
          <select className="select" value={f.gender ?? ''} onChange={(e) => setF({ gender: (e.target.value || undefined) as MetricFilters['gender'] })}>
            <option value="">الكل</option><option value="M">ذكور</option><option value="F">إناث</option>
          </select></label>
        <label className="field" style={{ flex: '1 1 120px' }}><span>الجنسية</span>
          <select className="select" value={f.is_saudi === undefined ? '' : f.is_saudi ? 'y' : 'n'} onChange={(e) => setF({ is_saudi: e.target.value === '' ? undefined : e.target.value === 'y' })}>
            <option value="">الكل</option><option value="y">سعودي</option><option value="n">غير سعودي</option>
          </select></label>
      </div>
      {depts.length > 0 && (
        <label className="field"><span>القسم</span>
          <select className="select" value={f.department?.[0] ?? ''} onChange={(e) => setF({ department: e.target.value ? [e.target.value] : undefined })}>
            <option value="">كل الأقسام</option>
            {depts.map((d) => <option key={d.value} value={d.value}>{valueLabel('department', d.value)}</option>)}
          </select></label>
      )}
      {showGroups && (
        <div className="row">
          {[0, 1].map((i) => (
            <label key={i} className="field" style={{ flex: '1 1 160px' }}><span>{i === 0 ? 'الصفوف حسب' : 'الأعمدة حسب'}</span>
              <select className="select" value={value.group_by[i] ?? ''} disabled={i === 1 && !value.group_by[0]} onChange={(e) => {
                const g = [...value.group_by];
                if (e.target.value) g[i] = e.target.value as Dimension; else g.splice(i);
                onChange({ ...value, group_by: [...new Set(g.filter(Boolean))].slice(0, 2) });
              }}>
                <option value="">{i === 0 ? 'بلا تفصيل (رقم واحد)' : 'بلا أعمدة'}</option>
                {DIMENSION_ORDER.filter((d) => d !== value.group_by[1 - i]).map((d) => <option key={d} value={d}>{DIMENSIONS[d]}</option>)}
              </select></label>
          ))}
        </div>
      )}
    </div>
  );
}
