import { NoiseReductionConfig, ObservabilityEvent } from '../types';
type NoiseStats = {
    dropped: number;
    folded: number;
    aggregated: number;
    downgraded: number;
    kept: number;
    approxBytesSaved: number;
    droppedByType: Record<string, number>;
    droppedByOperation: Record<string, number>;
    foldedByType: Record<string, number>;
    foldedByOperation: Record<string, number>;
};
export type NoiseReductionResult = {
    events: ObservabilityEvent[];
    stats: NoiseStats;
};
export declare function applyNoiseReduction(inputEvents: ObservabilityEvent[], cfg: NoiseReductionConfig): NoiseReductionResult;
export {};
