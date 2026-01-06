/**
 * Testing utilities for noise reduction.
 * 
 * **FOR TESTING ONLY** - Exposes internal APIs for validation.
 * DO NOT USE IN PRODUCTION CODE.
 */

import type { ObservabilityEvent, NoiseReductionConfig } from '../types';
import type { TreeNode, EventTree } from './types';
import { buildEventTree } from './tree/builder';
import { evaluateDecisions } from './tree/evaluator';
import { propagateHardSignals } from './tree/propagator';
import { transformTree } from './tree/transformer';
import { getBuiltinRules } from './rules/builtins';
import { matchesRule } from './rules/matcher';
import { isHardSignal } from './hard-signals';

/**
 * Result of building and evaluating a tree (Phases 1-2.5).
 */
export interface TreeStateResult {
  /** Node map for lookups (from EventTree.nodeById) */
  tree: ReadonlyMap<string, TreeNode>;

  /** Root nodes */
  roots: TreeNode[];

  /** All nodes as array (for easier iteration) */
  nodes: TreeNode[];
}

/**
 * Build tree and evaluate decisions (Phases 1-2.5) without transforming.
 * Useful for inspecting intermediate state.
 */
export function buildAndEvaluateTree(
  events: ObservabilityEvent[],
  config: NoiseReductionConfig
): TreeStateResult {
  // Phase 1: Build tree
  const eventTree = buildEventTree(events);

  // Get roots from tree
  const roots = [ ...eventTree.roots ];

  // Get all rules
  const presetRules = getBuiltinRules(config.presets || []);
  const userRules = config.rules || [];
  const allRules = [ ...presetRules, ...userRules ];

  // Phase 2: Evaluate decisions (recursive on each root)
  for (const root of roots) {
    evaluateDecisions(root, config, allRules);
  }

  // Phase 2.5: Propagate hard signals (recursive on each root)
  for (const root of roots) {
    propagateHardSignals(root, config);
  }

  // Convert to array for easier testing
  const nodes = Array.from(eventTree.nodeById.values());

  return { tree: eventTree.nodeById, roots, nodes };
}

/**
 * Get a node from tree by ID.
 */
export function getNode(tree: ReadonlyMap<string, TreeNode>, id: string): TreeNode | undefined {
  return tree.get(id);
}

/**
 * Find all nodes with a specific decision.
 */
export function findNodesByDecision(
  nodes: TreeNode[],
  decision: 'keep' | 'drop' | 'fold' | 'aggregate' | 'downgrade'
): TreeNode[] {
  return nodes.filter(n => n.decision === decision);
}

/**
 * Find all hard signal nodes.
 * Note: Hard signals are computed on-demand, not stored on nodes.
 */
export function findHardSignalNodes(nodes: TreeNode[], config: NoiseReductionConfig): TreeNode[] {
  return nodes.filter(n => isHardSignal(n.event, config));
}

/**
 * Find all nodes with hasHardSignalInSubtree set.
 */
export function findNodesWithHardSignalInSubtree(nodes: TreeNode[]): TreeNode[] {
  return nodes.filter(n => n.hasHardSignalInSubtree);
}

/**
 * Verify that hasHardSignalInSubtree is correctly propagated.
 * Throws if validation fails.
 */
export function verifyHardSignalPropagation(tree: ReadonlyMap<string, TreeNode>, config: NoiseReductionConfig): void {
  for (const node of tree.values()) {
    // Check if node is a hard signal
    const nodeIsHardSignal = isHardSignal(node.event, config);

    // Check if any child has hard signal in subtree
    const hasHardSignalChild = node.children.some(child => child.hasHardSignalInSubtree);

    // If node is itself a hard signal, it should have the flag
    if (nodeIsHardSignal && !node.hasHardSignalInSubtree) {
      throw new Error(
        `Node ${node.event.observabilityLogId} is a hard signal but hasHardSignalInSubtree is false`
      );
    }

    // If any child has hard signal, parent should too
    if (hasHardSignalChild && !node.hasHardSignalInSubtree) {
      throw new Error(
        `Node ${node.event.observabilityLogId} has hard signal in descendants but hasHardSignalInSubtree is false`
      );
    }

    // If flag is set, verify there's actually a hard signal somewhere
    if (node.hasHardSignalInSubtree && !nodeIsHardSignal && !hasHardSignalChild) {
      throw new Error(
        `Node ${node.event.observabilityLogId} has hasHardSignalInSubtree=true but no hard signals found in subtree`
      );
    }
  }
}

/**
 * Verify parent-child relationships are consistent.
 */
export function verifyTreeStructure(tree: ReadonlyMap<string, TreeNode>): void {
  for (const node of tree.values()) {
    // Check parent reference
    if (node.parent !== undefined) {
      const parent = node.parent;

      // Check parent lists this as child
      if (!parent.children.some(c => c.event.observabilityLogId === node.event.observabilityLogId)) {
        throw new Error(
          `Node ${node.event.observabilityLogId} references parent ${parent.event.observabilityLogId} but parent doesn't list it as child`
        );
      }
    }

    // Check children references
    for (const child of node.children) {
      // Check child points back to this parent
      if (child.parent !== node) {
        throw new Error(
          `Node ${node.event.observabilityLogId} lists ${child.event.observabilityLogId} as child but child's parent doesn't match`
        );
      }
    }
  }
}

/**
 * Count nodes by decision.
 */
export function countNodesByDecision(nodes: TreeNode[]): Record<string, number> {
  const counts: Record<string, number> = {
    keep: 0,
    drop: 0,
    fold: 0,
    aggregate: 0,
    downgrade: 0,
    undefined: 0,
  };

  for (const node of nodes) {
    const key = node.decision || 'undefined';
    counts[ key ] = (counts[ key ] || 0) + 1;
  }

  return counts;
}

/**
 * Assert a node has expected decision.
 */
export function expectNodeDecision(
  tree: ReadonlyMap<string, TreeNode>,
  nodeId: string,
  expectedDecision: 'keep' | 'drop' | 'fold' | 'aggregate' | 'downgrade'
): void {
  const node = tree.get(nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in tree`);
  }
  if (node.decision !== expectedDecision) {
    throw new Error(
      `Expected node ${nodeId} to have decision '${expectedDecision}', got '${node.decision}'`
    );
  }
}

/**
 * Assert a node is a hard signal.
 */
export function expectNodeIsHardSignal(
  tree: ReadonlyMap<string, TreeNode>,
  nodeId: string,
  expected: boolean,
  config: NoiseReductionConfig
): void {
  const node = tree.get(nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in tree`);
  }
  const actualIsHardSignal = isHardSignal(node.event, config);
  if (actualIsHardSignal !== expected) {
    throw new Error(
      `Expected node ${nodeId} to ${expected ? '' : 'NOT '}be a hard signal, got isHardSignal=${actualIsHardSignal}`
    );
  }
}

/**
 * Assert a node has hasHardSignalInSubtree set correctly.
 */
export function expectNodeHasHardSignalInSubtree(
  tree: ReadonlyMap<string, TreeNode>,
  nodeId: string,
  expected: boolean
): void {
  const node = tree.get(nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} not found in tree`);
  }
  if (node.hasHardSignalInSubtree !== expected) {
    throw new Error(
      `Expected node ${nodeId} to have hasHardSignalInSubtree=${expected}, got ${node.hasHardSignalInSubtree}`
    );
  }
}
