/**
 * Tiny in-process Prometheus metrics. No deps so it works in Worker SSR.
 *
 * Counters reset whenever the process restarts (typical for Prometheus —
 * Prometheus tracks rates via `rate()` and detects resets automatically).
 */

type LabelValues = Record<string, string | number>;

interface CounterEntry {
  name: string;
  help: string;
  values: Map<string, number>; // serialized labels => value
}

const counters = new Map<string, CounterEntry>();

function serializeLabels(labels: LabelValues): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`).join(",");
}

export function counter(name: string, help: string) {
  let entry = counters.get(name);
  if (!entry) {
    entry = { name, help, values: new Map() };
    counters.set(name, entry);
  }
  return {
    inc(labels: LabelValues = {}, by = 1) {
      const key = serializeLabels(labels);
      entry!.values.set(key, (entry!.values.get(key) ?? 0) + by);
    },
  };
}

/** Format all known counters as Prometheus text exposition format. */
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const c of counters.values()) {
    lines.push(`# HELP ${c.name} ${c.help}`);
    lines.push(`# TYPE ${c.name} counter`);
    if (c.values.size === 0) {
      lines.push(`${c.name} 0`);
    } else {
      for (const [labels, v] of c.values) {
        lines.push(labels.length > 0 ? `${c.name}{${labels}} ${v}` : `${c.name} ${v}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

// Pre-register the metrics we use so /metrics always lists them.
export const requestsTotal = counter("app_requests_total", "Total HTTP requests handled");
export const requestErrorsTotal = counter("app_request_errors_total", "Total HTTP requests resulting in 4xx/5xx");
export const requestDurationMsSum = counter("app_request_duration_ms_sum", "Sum of request durations in ms");
export const auditEventsTotal = counter("app_audit_events_total", "Audit events written");