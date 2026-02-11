import { MeiliSearchEngine, ExtendedMeiliSearchClientConfig, SearchIndexConfigExt } from '../engine';
export declare const TEST_DOCS: {
    id: string;
    title: string;
    content: string;
    category: string;
    tags: string[];
    price: number;
    status: string;
}[];
export declare const TEST_VECTOR_DOCS: {
    id: string;
    title: string;
    content: string;
    _vectors: {
        default: number[];
    };
}[];
export declare const config: ExtendedMeiliSearchClientConfig;
export declare const indexConfig: SearchIndexConfigExt;
export declare function pollForDocument(engine: MeiliSearchEngine, indexConfig: SearchIndexConfigExt, docId: string, maxAttempts?: number, interval?: number): Promise<void>;
export declare function pollForDocumentAbsence(engine: MeiliSearchEngine, indexConfig: SearchIndexConfigExt, docId: string, maxAttempts?: number, interval?: number): Promise<void>;
export declare function pollForSetting(engine: MeiliSearchEngine, indexName: string, key: string, expected: any, maxAttempts?: number, interval?: number): Promise<void>;
