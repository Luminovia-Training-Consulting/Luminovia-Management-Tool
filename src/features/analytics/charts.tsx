import { useEffect, useRef, type CSSProperties } from "react";

export type ChartSeries = {
  name: string;
  values: (number | null)[];
  tone: "past" | "future" | "open";
};

export function ChartKey({
  series,
}: {
  series: Pick<ChartSeries, "name" | "tone">[];
}) {
  return (
    <ul className="analytics-key">
      {series.map(({ name, tone }) => (
        <li key={tone}>
          <span
            className={`analytics-swatch analytics-${tone}`}
            aria-hidden="true"
          />
          {name}
        </li>
      ))}
    </ul>
  );
}

export function ChartTable({
  title,
  month,
  labels,
  series,
  format,
}: {
  title: string;
  month: string;
  labels: string[];
  series: ChartSeries[];
  format: (value: number) => string;
}) {
  return (
    <details className="analytics-data">
      <summary>{title}</summary>
      <div
        className="analytics-scroll"
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{month}</th>
              {series.map(({ name }) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label, index) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {series.map(({ name, values }) => (
                  <td key={name}>
                    {values[index] == null ? "—" : format(values[index])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const timelineSize = (length: number) =>
  ({ "--analytics-columns": length }) as CSSProperties;

export function BarChart({
  labels,
  series,
  format,
}: {
  labels: string[];
  series: ChartSeries[];
  format: (value: number) => string;
}) {
  const max = Math.max(
    1,
    ...series.flatMap(({ values }) => values.map((value) => value ?? 0)),
  );
  return (
    <div className="analytics-scroll" aria-hidden="true">
      <div className="analytics-timeline" style={timelineSize(labels.length)}>
        <div className="analytics-axis">
          <span>{format(max)}</span>
          <span>{format(0)}</span>
        </div>
        <div className="analytics-bars">
          {labels.map((label, index) => (
            <div key={label} className="analytics-bar-group">
              {series.map(({ name, values, tone }) => {
                const value = values[index] ?? 0;
                return (
                  <span
                    key={tone}
                    className={`analytics-bar analytics-${tone}`}
                    style={{ height: `${(value * 100) / max}%` }}
                    title={
                      value
                        ? `${label} · ${name} · ${format(value)}`
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
        <div className="analytics-months">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TimeDonut({
  past,
  future,
  pastLabel,
  futureLabel,
  empty,
  format,
  percent,
}: {
  past: number;
  future: number;
  pastLabel: string;
  futureLabel: string;
  empty: string;
  format: (value: number) => string;
  percent: (value: number) => string;
}) {
  const total = past + future;
  if (!total) return <p className="analytics-muted">{empty}</p>;
  const split = past / total;
  return (
    <div className="analytics-donut-layout">
      <div
        className="analytics-donut"
        aria-hidden="true"
        style={{ "--analytics-split": `${split * 100}%` } as CSSProperties}
      >
        <strong>{format(total)}</strong>
      </div>
      <dl className="analytics-time-legend">
        <div>
          <dt>
            <span
              className="analytics-swatch analytics-past"
              aria-hidden="true"
            />
            {pastLabel}
          </dt>
          <dd>
            {format(past)} <small>({percent(split)})</small>
          </dd>
        </div>
        <div>
          <dt>
            <span
              className="analytics-swatch analytics-future"
              aria-hidden="true"
            />
            {futureLabel}
          </dt>
          <dd>
            {format(future)} <small>({percent(1 - split)})</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function LineChart({
  labels,
  series,
  format,
}: {
  labels: string[];
  series: ChartSeries[];
  format: (value: number) => string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const values = series.flatMap((item) =>
    item.values.map((value) => value ?? 0),
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const highest = max === min ? 1 : max;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    function draw() {
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      const context = element.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);

      const colors = getComputedStyle(element);
      const padding = 8;
      const y = (value: number) =>
        height -
        padding -
        ((value - min) / (highest - min)) * (height - padding * 2);
      const x = (index: number) => ((index + 0.5) * width) / labels.length;
      context.strokeStyle = colors.getPropertyValue("--line").trim();
      context.lineWidth = 1;
      for (const value of new Set([highest, 0, min])) {
        context.beginPath();
        context.moveTo(0, y(value));
        context.lineTo(width, y(value));
        context.stroke();
      }
      for (const { values: points, tone } of series) {
        context.strokeStyle = colors
          .getPropertyValue(`--analytics-${tone}`)
          .trim();
        context.fillStyle = context.strokeStyle;
        context.lineWidth = 2.25;
        context.setLineDash(tone === "future" ? [5, 4] : []);
        context.beginPath();
        points.forEach((value, index) => {
          if (value === null) return;
          if (index === 0 || points[index - 1] == null)
            context.moveTo(x(index), y(value));
          else context.lineTo(x(index), y(value));
        });
        context.stroke();
        context.setLineDash([]);
        points.forEach((value, index) => {
          if (value === null) return;
          context.beginPath();
          context.arc(x(index), y(value), 3.5, 0, Math.PI * 2);
          if (tone === "future") context.stroke();
          else context.fill();
        });
      }
    }
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
    };
  }, [highest, labels.length, min, series]);

  return (
    <div className="analytics-scroll" aria-hidden="true">
      <div className="analytics-timeline" style={timelineSize(labels.length)}>
        <div className="analytics-axis">
          <span>{format(highest)}</span>
          {min !== 0 && highest !== 0 && (
            <span style={{ top: `${(highest * 100) / (highest - min)}%` }}>
              {format(0)}
            </span>
          )}
          <span>{format(min)}</span>
        </div>
        <canvas ref={canvas} className="analytics-line-chart" />
        <div className="analytics-months">
          {labels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
