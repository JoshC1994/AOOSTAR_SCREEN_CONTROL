import {useEffect, useRef} from 'react';
import ApexCharts, {type ApexOptions} from 'apexcharts';

interface ApexChartBoxProps {
  options: ApexOptions;
  series: ApexOptions['series'];
  type: 'area' | 'line' | 'bar' | 'radialBar' | 'donut';
  height: number | string;
}

export function ApexChartBox({options, series, type, height}: ApexChartBoxProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ApexCharts | null>(null);
  const signatureRef = useRef<string>('');

  const seriesList = Array.isArray(series) ? series : [];
  const structuralSignature = JSON.stringify({
    type,
    height,
    colors: options.colors,
    stroke: options.stroke,
    horizontal: options.plotOptions?.bar?.horizontal ?? false,
    plotOptions: options.plotOptions,
    xaxisCategories: (options.xaxis?.categories ?? []).join('|'),
    labels: options.labels,
    seriesCount: seriesList.length,
    seriesNames: seriesList
      .map((s) => (typeof s === 'object' && s !== null && 'name' in s ? String(s.name ?? '') : ''))
      .join('|'),
    legendShow: options.legend?.show ?? false,
    fillType: options.fill?.type ?? '',
    sparkline: options.chart?.sparkline?.enabled ?? false,
    yaxisMin: Array.isArray(options.yaxis) ? undefined : options.yaxis?.min,
    yaxisMax: Array.isArray(options.yaxis) ? undefined : options.yaxis?.max,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (!chartRef.current || signatureRef.current !== structuralSignature) {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
      signatureRef.current = structuralSignature;
      const chart = new ApexCharts(el, {
        ...options,
        chart: {
          ...options.chart,
          type,
          height,
          background: 'transparent',
          toolbar: {show: false},
          animations: {enabled: false},
          fontFamily: options.chart?.fontFamily || 'JetBrains Mono, monospace',
        },
        theme: {mode: 'dark'},
        series,
      });
      void chart.render();
      chartRef.current = chart;
    } else {
      void chartRef.current.updateSeries(series as never, false);
    }
  }, [options, series, type, height, structuralSignature]);

  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
