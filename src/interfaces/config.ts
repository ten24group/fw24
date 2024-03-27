export interface IApplicationConfig {
    name?: string;
    coreVersion?: number;
    region?: string;
    account?: string;
    defaultAuthorizationType?: any;
    stage?: string; // local, dev, prod
}
