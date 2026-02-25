export declare class HMRWatcher {
    private readonly directory;
    private readonly onChange;
    private timer;
    constructor(directory: string, onChange: () => void);
    start(): void;
}
