// Split-pane layout for one terminal tab, as an immutable binary tree.

export type SplitDirection = "row" | "col"; // row = side by side, col = stacked

export interface Leaf {
  type: "leaf";
  id: string;
  terminalId: string;
}

export interface Split {
  type: "split";
  id: string;
  dir: SplitDirection;
  /** Share of the space given to `a` (0.1 - 0.9). */
  ratio: number;
  a: PaneNode;
  b: PaneNode;
}

export type PaneNode = Leaf | Split;

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 0.9;

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function makeLeaf(terminalId: string): Leaf {
  return { type: "leaf", id: newId("pane"), terminalId };
}

export function collectLeaves(node: PaneNode): Leaf[] {
  return node.type === "leaf" ? [node] : [...collectLeaves(node.a), ...collectLeaves(node.b)];
}

export function findLeaf(node: PaneNode, paneId: string): Leaf | null {
  return collectLeaves(node).find((l) => l.id === paneId) ?? null;
}

/** Replaces the leaf `paneId` with a split holding the old leaf and `fresh`. */
export function splitLeaf(node: PaneNode, paneId: string, dir: SplitDirection, fresh: Leaf): PaneNode {
  if (node.type === "leaf") {
    if (node.id !== paneId) return node;
    return { type: "split", id: newId("split"), dir, ratio: 0.5, a: node, b: fresh };
  }
  return { ...node, a: splitLeaf(node.a, paneId, dir, fresh), b: splitLeaf(node.b, paneId, dir, fresh) };
}

/** Removes a leaf and collapses its parent split. Returns null when the tree becomes empty. */
export function removeLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (!a) return b;
  if (!b) return a;
  return { ...node, a, b };
}

export function setRatio(node: PaneNode, splitId: string, ratio: number): PaneNode {
  if (node.type === "leaf") return node;
  const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  if (node.id === splitId) return { ...node, ratio: clamped };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

export function replaceSession(node: PaneNode, paneId: string, terminalId: string): PaneNode {
  if (node.type === "leaf") return node.id === paneId ? { ...node, terminalId } : node;
  return { ...node, a: replaceSession(node.a, paneId, terminalId), b: replaceSession(node.b, paneId, terminalId) };
}

/** Next leaf in reading order after `paneId` (wraps around). */
export function neighbourLeaf(node: PaneNode, paneId: string, step: 1 | -1): Leaf | null {
  const leaves = collectLeaves(node);
  const i = leaves.findIndex((l) => l.id === paneId);
  if (i < 0 || leaves.length === 0) return null;
  return leaves[(i + step + leaves.length) % leaves.length] ?? null;
}
