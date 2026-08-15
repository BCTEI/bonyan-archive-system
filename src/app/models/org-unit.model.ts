// OrgUnit / OrgUnitInput are declared once in src/types/electron.d.ts (the IPC
// contract shared with the main process) — reused here instead of redeclared to
// avoid two drifting copies of the same shape.
import type { OrgUnit, OrgUnitInput } from '../../types/electron';

export type { OrgUnit, OrgUnitInput };

export interface OrgUnitNode extends OrgUnit {
  children: OrgUnitNode[];
}

export const UNIT_TYPE_LABELS: Record<OrgUnit['unit_type'], string> = {
  administration: 'إدارة',
  section: 'قسم'
};

/**
 * Builds a parent/children tree from a flat list of org units.
 * Roots are units with parent_id === null (or pointing at a unit not present
 * in the given list, e.g. when fetching an active-only subset).
 */
export function buildOrgTree(units: OrgUnit[]): OrgUnitNode[] {
  const nodeMap = new Map<number, OrgUnitNode>();
  for (const unit of units) {
    nodeMap.set(unit.id, { ...unit, children: [] });
  }

  const roots: OrgUnitNode[] = [];
  for (const unit of units) {
    const node = nodeMap.get(unit.id)!;
    const parent = unit.parent_id !== null ? nodeMap.get(unit.parent_id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export interface FlatOrgUnit {
  unit: OrgUnit;
  depth: number;
}

/**
 * Flattens a tree (parent-before-children, siblings in original order) into a
 * depth-indexed list — used to render depth-indented <mat-select> options.
 */
export function flattenOrgTree(nodes: OrgUnitNode[], depth = 0): FlatOrgUnit[] {
  const result: FlatOrgUnit[] = [];
  for (const { children, ...unit } of nodes) {
    result.push({ unit: unit as OrgUnit, depth });
    result.push(...flattenOrgTree(children, depth + 1));
  }
  return result;
}
