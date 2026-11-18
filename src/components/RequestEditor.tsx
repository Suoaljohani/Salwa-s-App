import type { Catalog, DatasetColumn, Filter, FilterOp, GroupBy, MeasureOp, StatRequest } from '../lib/metrics/types';
import { MEASURE_LABEL, defaultBins, keyLabel } from '../lib/metrics/catalog';
import { IconClose, IconPlus } from './Icons';

const OPS_BY_TYPE: Record<string, { op: FilterOp; label: string }[]> = {
  text: [{ op: 'eq', label: 'يساوي' }, { op: 'neq', label: 'لا يساوي' }, { op: 'contains', label: 'يحتوي' }, { op: 'is_null', label: 'غير مسجّل' }, { op: 'not_null', label: 'مسجّل' }],
  number: [{ op: 'gte', label: 'من (≥)' }, { op: 'lt', label: 'أقل من' }, { op: 'eq', label: 'يساوي' }, { op: 'gt', label: 'أكبر من' }, { op: 'lte', label: 'حتى (≤)' }, { op: 'is_null', label: 'غير مسجّل' }],
  date: [{ op: 'gte', label: 'من تاريخ' }, { op: 'lt', label: 'قبل تاريخ' }, { op: 'eq', label: 'في تاريخ' }, { op: 'is_null', label: 'غير مسجّل' }],
  datetime: [{ op: 'gte', label: 'من تاريخ' }, { op: 'lt', label: 'قبل تاريخ' }, { op: 'is_null', label: 'غير مسجّل' }],
  boolean: [{ op: 'eq', label: 'يساوي' }],
};

export function newRequest(cat: Catalog | null, datasetId?: string): StatRequest | null {
  const ds = cat?.datasets.find((d) => d.id === datasetId) ?? cat?.datasets.find((d) => d.row_count > 0) ?? cat?.datasets[0];
  if (!ds) return null;
  const dim = ds.columns.find((c) => c.role === 'dimension' && (c.values?.length ?? 99) <= 15);
  return { dataset_id: ds.id, measure: { op: 'count' }, filters: [], group_by: dim ? [{ column: dim.key }] : [], period: null };
}

function groupFor(c: DatasetColumn): GroupBy {
  if (c.type === 'date' || c.type === 'datetime') return { column: c.key, grain: 'month' };
  if (c.type === 'number') return { column: c.key, bins: defaultBins(c) };
  return { column: c.key };
}

/** Structured editor for one statistics request. Shared by Export and Fill, so both use the same contract. */
export function RequestEditor({ value, onChange, catalog, showGroups = true, showPeriod = true, lockDataset = false }: {
  value: StatRequest; onChange: (r: StatRequest) => void; catalog: Catalog | null; showGroups?: boolean; showPeriod?: boolean; lockDataset?: boolean;
}) {
  const ds = catalog?.datasets.find((d) => d.id === value.dataset_id);
  const cols = ds?.columns.filter((c) => c.role !== 'ignore') ?? [];
  const filterCols = cols.filter((c) => c.role !== 'identifier');
  const numCols = cols.filter((c) => c.type === 'number');
  const set = (patch: Partial<StatRequest>) => onChange({ ...value, ...patch });
  const setFilter = (i: number, f: Filter | null) => {
    const next = [...value.filters];
    if (f) next[i] = f; else next.splice(i, 1);
    set({ filters: next });
  };

  return (
    <div className="stack">
      {!lockDataset && (catalog?.datasets.length ?? 0) > 1 && (
        <label className="field"><span>قاعدة البيانات</span>
          <select className="select" value={value.dataset_id} onChange={(e) => onChange(newRequest(catalog, e.target.value)!)}>
            {catalog!.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
      )}
      <div className="row">
        <label className="field" style={{ flex: '1 1 140px' }}><span>الحساب</span>
          <select className="select" value={value.measure.op} onChange={(e) => {
            const op = e.target.value as MeasureOp;
            const column = op === 'count' ? undefined : op === 'count_distinct' ? (cols.find((c) => c.role === 'identifier') ?? cols[0])?.key : numCols[0]?.key;
            set({ measure: op === 'count' ? { op } : { op, column } });
          }}>
            <option value="count">عدد {ds?.unit_label ?? 'السجلات'}</option>
            <option value="count_distinct">{MEASURE_LABEL.count_distinct}</option>
            {numCols.length > 0 && (['sum', 'avg', 'min', 'max'] as MeasureOp[]).map((op) => <option key={op} value={op}>{MEASURE_LABEL[op]}</option>)}
          </select></label>
        {value.measure.op !== 'count' && (
          <label className="field" style={{ flex: '1 1 160px' }}><span>العمود</span>
            <select className="select" value={value.measure.column ?? ''} onChange={(e) => set({ measure: { ...value.measure, column: e.target.value } })}>
              {(value.measure.op === 'count_distinct' ? cols : numCols).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select></label>
        )}
      </div>

      {showPeriod && ds?.period_column && (
        <div className="row">
          <label className="field"><span>من (شامل)</span><input className="input" type="date" dir="ltr" value={value.period?.start ?? ''}
            onChange={(e) => set({ period: e.target.value ? { start: e.target.value, end_exclusive: value.period?.end_exclusive ?? e.target.value } : null })} /></label>
          <label className="field"><span>إلى (غير شامل)</span><input className="input" type="date" dir="ltr" value={value.period?.end_exclusive ?? ''}
            onChange={(e) => set({ period: e.target.value && value.period ? { ...value.period, end_exclusive: e.target.value } : value.period })} /></label>
          {value.period && <button type="button" className="btn btn--sm btn--ghost" onClick={() => set({ period: null })}>كل الفترة</button>}
        </div>
      )}

      <div className="stack">
        {value.filters.map((f, i) => {
          const c = filterCols.find((x) => x.key === f.column);
          const ops = OPS_BY_TYPE[c?.type ?? 'text'];
          const needsValue = f.op !== 'is_null' && f.op !== 'not_null';
          return (
            <div key={i} className="row" style={{ alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: '1 1 130px' }}><span>المرشح</span>
                <select className="select" value={f.column} onChange={(e) => {
                  const nc = filterCols.find((x) => x.key === e.target.value)!;
                  setFilter(i, { column: nc.key, op: OPS_BY_TYPE[nc.type][0].op, value: nc.values?.[0]?.value ?? '' });
                }}>{filterCols.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>
              <label className="field" style={{ flex: '0 1 110px' }}><span>الشرط</span>
                <select className="select" value={f.op} onChange={(e) => setFilter(i, { ...f, op: e.target.value as FilterOp })}>
                  {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
                </select></label>
              {needsValue && (
                <label className="field" style={{ flex: '1 1 130px' }}><span>القيمة</span>
                  {c?.type === 'text' && c.values?.length && f.op !== 'contains' ? (
                    <select className="select" value={String(f.value ?? '')} onChange={(e) => setFilter(i, { ...f, value: e.target.value })}>
                      {c.values.map((v) => <option key={v.value} value={v.value}>{keyLabel(c, undefined, v.value)}</option>)}
                    </select>
                  ) : c?.type === 'boolean' ? (
                    <select className="select" value={String(f.value)} onChange={(e) => setFilter(i, { ...f, value: e.target.value === 'true' })}>
                      <option value="true">نعم</option><option value="false">لا</option>
                    </select>
                  ) : (
                    <input className="input" dir={c?.type === 'text' ? 'auto' : 'ltr'} type={c?.type === 'date' || c?.type === 'datetime' ? 'date' : c?.type === 'number' ? 'text' : 'text'}
                      inputMode={c?.type === 'number' ? 'decimal' : undefined} value={String(f.value ?? '')}
                      onChange={(e) => setFilter(i, { ...f, value: c?.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
                  )}
                </label>
              )}
              <button type="button" className="icon-btn" aria-label="حذف المرشح" onClick={() => setFilter(i, null)}><IconClose aria-hidden /></button>
            </div>
          );
        })}
        {filterCols.length > 0 && (
          <button type="button" className="btn btn--sm btn--quiet" style={{ alignSelf: 'flex-start' }} onClick={() => {
            const c = filterCols.find((x) => x.role === 'dimension') ?? filterCols[0];
            set({ filters: [...value.filters, { column: c.key, op: OPS_BY_TYPE[c.type][0].op, value: c.values?.[0]?.value ?? '' }] });
          }}><IconPlus aria-hidden />إضافة مرشح</button>
        )}
      </div>

      {showGroups && (
        <div className="row">
          {[0, 1].map((i) => (
            <label key={i} className="field" style={{ flex: '1 1 160px' }}><span>{i === 0 ? 'الصفوف حسب' : 'الأعمدة حسب'}</span>
              <select className="select" value={value.group_by[i]?.column ?? ''} disabled={i === 1 && !value.group_by[0]} onChange={(e) => {
                const g = [...value.group_by];
                if (e.target.value) g[i] = groupFor(cols.find((c) => c.key === e.target.value)!); else g.splice(i);
                set({ group_by: g.filter(Boolean).slice(0, 2) });
              }}>
                <option value="">{i === 0 ? 'بلا تفصيل (رقم واحد)' : 'بلا أعمدة'}</option>
                {cols.filter((c) => c.role !== 'identifier' && c.key !== value.group_by[1 - i]?.column).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              {value.group_by[i] && ['date', 'datetime'].includes(cols.find((c) => c.key === value.group_by[i].column)?.type ?? '') && (
                <select className="select" aria-label="الوحدة الزمنية" value={value.group_by[i].grain ?? 'month'} onChange={(e) => {
                  const g = [...value.group_by]; g[i] = { ...g[i], grain: e.target.value as GroupBy['grain'] }; set({ group_by: g });
                }}><option value="day">يومي</option><option value="month">شهري</option><option value="year">سنوي</option></select>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
