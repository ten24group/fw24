export interface IApplicationConfig {
    name?: string;
    coreVersion?: number;
    region?: string;
    account?: string;
    defaultAuthorizationType?: any;
    environment?: string; // local, dev, prod
}

