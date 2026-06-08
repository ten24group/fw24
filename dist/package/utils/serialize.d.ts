export declare const getCircularReplacer: () => (key: any, value: any) => any;
export declare function jsonStringifyReplacer(key: string, value: any): any;
export declare class JsonSerializer {
    static stringify<T = any>(value: T): string;
}
export declare const deepCopy: <T = any>(obj: T) => T;
