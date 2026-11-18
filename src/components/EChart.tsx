import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { AriaComponent, AxisPointerComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, AxisPointerComponent, AriaComponent, SVGRenderer]);

/**
 * One persistent ECharts instance per mount. Option changes are applied with setOption
 * (series keep their ids, so ECharts animates an update instead of re-entering).
 * Instance, observer and listeners are disposed on unmount.
 */
export function EChart({ option, label, height }: { option: EChartsCoreOption; label: string; height?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const node = el.current!;
    const inst = echarts.init(node, null, { renderer: 'svg' });
    chart.current = inst;
    const ro = new ResizeObserver(() => { if (node.clientWidth > 0) inst.resize(); });
    ro.observe(node);
    return () => { ro.disconnect(); inst.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    const inst = chart.current;
    if (!inst) return;
    let cancelled = false;
    // Draw only after the Arabic font is ready, so labels are measured once with the right metrics.
    document.fonts.ready.then(() => {
      if (cancelled || inst.isDisposed()) return;
      inst.setOption(option, { replaceMerge: ['series', 'xAxis', 'yAxis'] });
    });
    return () => { cancelled = true; };
  }, [option]);

  return <div ref={el} className="chart" role="img" aria-label={label} dir="ltr" style={height ? { height } : undefined} />;
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
