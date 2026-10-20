// French formatting helpers (units as shown in the UI).

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const n = value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${n.replace(".", ",")} ${units[i]}`;
}

export function formatKb(kb: number): string {
  return formatBytes(kb * 1024);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d} j ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m} min ${sec} s`;
  return `${sec} s`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 0 : 1).replace(".", ",")} %`;
}

export function formatAgo(ms: number, now = Date.now()): string {
  const diff = Math.max(0, now - ms) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 2) return "hier";
  return new Date(ms).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
