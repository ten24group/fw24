/**
 * Testing utilities for noise reduction.
 *
 * **FOR TESTING ONLY** - Exposes internal APIs for validation.
 * DO NOT USE IN PRODUCTION CODE.
 */
import type { ObservabilityEvent, NoiseReductionConfig } from '../types';
import type { TreeNode } from './types';
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
export declare function buildAndEvaluateTree(events: ObservabilityEvent[], config: NoiseReductionConfig): TreeStateResult;
/**
 * Get a node from tree by ID.
 */
export declare function getNode(tree: ReadonlyMap<string, TreeNode>, id: string): TreeNode | undefined;
/**
 * Find all nodes with a specific decision.
 */
export declare function findNodesByDecision(nodes: TreeNode[], decision: 'keep' | 'drop' | 'fold' | 'aggregate' | 'downgrade'): TreeNode[];
/**
 * Find all hard signal nodes.
 * Note: Hard signals are computed on-demand, not stored on nodes.
 */
export declare function findHardSignalNodes(nodes: TreeNode[], config: NoiseReductionConfig): TreeNode[];
/**
 * Find all nodes with hasHardSignalInSubtree set.
 */
export declare function findNodesWithHardSignalInSubtree(nodes: TreeNode[]): TreeNode[];
/**
 * Verify that hasHardSignalInSubtree is correctly propagated.
 * Throws if validation fails.
 */
export declare function verifyHardSignalPropagation(tree: ReadonlyMap<string, TreeNode>, config: NoiseReductionConfig): void;
/**
 * Verify parent-child relationships are consistent.
 */
export declare function verifyTreeStructure(tree: ReadonlyMap<string, TreeNode>): void;
/**
 * Count nodes by decision.
 */
export declare function countNodesByDecision(nodes: TreeNode[]): Record<string, number>;
/**
 * Assert a node has expected decision.
 */
export declare function expectNodeDecision(tree: ReadonlyMap<string, TreeNode>, nodeId: string, expectedDecision: 'keep' | 'drop' | 'fold' | 'aggregate' | 'downgrade'): void;
/**
 * Assert a node is a hard signal.
 */
export declare function expectNodeIsHardSignal(tree: ReadonlyMap<string, TreeNode>, nodeId: string, expected: boolean, config: NoiseReductionConfig): void;
/**
 * Assert a node has hasHardSignalInSubtree set correctly.
 */
export declare function expectNodeHasHardSignalInSubtree(tree: ReadonlyMap<string, TreeNode>, nodeId: string, expected: boolean): void;
