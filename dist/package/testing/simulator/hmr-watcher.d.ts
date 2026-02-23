export declare class HMRWatcher {
    private readonly directory;
    private readonly onChange;
    constructor(directory: string, onChange: () => void);
    start(): void;
}
