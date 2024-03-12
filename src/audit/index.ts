export * as Auditor from './';

export interface IAuditor {
    audit (options: any): Promise<any>;
}

export const Dummy: IAuditor = {
    audit: () => { return Promise.resolve() },
};


export const Default: IAuditor = {
    audit: async (options: any) => {
        console.log("Called default auditor.audit()", options);
    }
};