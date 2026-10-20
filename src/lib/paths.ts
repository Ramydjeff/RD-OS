import type { Location } from "@/types/ipc";

/** Path relative to a project root, always `/`-separated, "" for the root. */
export type RelPath = string;

export function joinRel(parent: RelPath, name: string): RelPath {
  return parent ? `${parent}/${name}` : name;
}

export function parentRel(rel: RelPath): RelPath {
  const i = rel.lastIndexOf("/");
  return i < 0 ? "" : rel.slice(0, i);
}

export function baseName(rel: RelPath): string {
  const i = rel.lastIndexOf("/");
  return i < 0 ? rel : rel.slice(i + 1);
}

export function locationDisplay(loc: Location): string {
  return loc.kind === "linux" ? `${loc.distro}:${loc.path}` : loc.path;
}

export function locationName(loc: Location): string {
  if (loc.kind === "linux") {
    const parts = loc.path.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? loc.distro;
  }
  const parts = loc.path.split("\\").filter(Boolean);
  return parts[parts.length - 1] ?? loc.path;
}

export function locationKey(loc: Location): string {
  return loc.kind === "linux" ? `linux:${loc.distro}:${loc.path}` : `windows:${loc.path.toLowerCase()}`;
}

export function sameLocation(a: Location | null, b: Location | null): boolean {
  if (!a || !b) return a === b;
  return locationKey(a) === locationKey(b);
}

/** Location of `rel` below `root`. */
export function childLocation(root: Location, rel: RelPath): Location {
  if (!rel) return root;
  if (root.kind === "linux") {
    const base = root.path === "/" ? "" : root.path.replace(/\/+$/, "");
    return { kind: "linux", distro: root.distro, path: `${base}/${rel}` };
  }
  const base = root.path.replace(/\\+$/, "");
  return { kind: "windows", path: `${base}\\${rel.replaceAll("/", "\\")}` };
}

export function parentLocation(loc: Location): Location | null {
  if (loc.kind === "linux") {
    if (loc.path === "/") return null;
    const i = loc.path.lastIndexOf("/");
    return { kind: "linux", distro: loc.distro, path: i <= 0 ? "/" : loc.path.slice(0, i) };
  }
  const trimmed = loc.path.replace(/\\+$/, "");
  const i = trimmed.lastIndexOf("\\");
  if (i < 0 || /^[A-Za-z]:$/.test(trimmed)) return null;
  const parent = trimmed.slice(0, i);
  if (/^[A-Za-z]:$/.test(parent)) return { kind: "windows", path: `${parent}\\` };
  if (parent.startsWith("\\\\") && parent.split("\\").filter(Boolean).length < 2) return null;
  return { kind: "windows", path: parent };
}

/** Windows drive mounted into WSL (`/mnt/c/...`): slower than the Linux filesystem. */
export function isMountedWindowsPath(loc: Location): boolean {
  return loc.kind === "linux" && /^\/mnt\/[a-z](\/|$)/i.test(loc.path);
}

/** Names that cannot be used for a file or folder (mirrors the backend rules). */
export function validateEntryName(name: string): string | null {
  if (!name.trim()) return "Saisissez un nom.";
  if (name.length > 255) return "Ce nom est trop long.";
  if (name === "." || name === "..") return "Ce nom est réservé.";
  if (/[\\/<>:"|?*\u0000-\u001f]/.test(name)) return 'Un nom ne peut pas contenir / \\ < > : " | ? *';
  if (/[. ]$/.test(name)) return "Un nom ne peut pas finir par un point ou une espace.";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) return "Ce nom est réservé par Windows.";
  return null;
}

export function validateProjectName(name: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) || name.endsWith(".")) {
    return "Lettres, chiffres, « . », « _ » ou « - » (64 max.), en commençant par une lettre ou un chiffre.";
  }
  return validateEntryName(name);
}

/** Path as Windows sees it (\\wsl.localhost\<distro>\... for Linux), mirroring Location::host_path. */
export function hostPathOf(loc: Location): string {
  if (loc.kind === "windows") return loc.path;
  const segs = loc.path.split("/").filter(Boolean);
  return `\\\\wsl.localhost\\${loc.distro}\\${segs.join("\\")}`;
}
