import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput } from "../interfaces/construct";
import { Stack } from "aws-cdk-lib";
import { IConstructConfig } from "../interfaces/construct-config";
/**
 * Represents the configuration for a certificate construct.
 */
export interface ICertificateConstructConfig extends IConstructConfig {
    domainName: string;
    certificateArn?: string;
}
export declare class CertificateConstruct implements FW24Construct {
    private certificateConstructConfig;
    readonly logger: import("tslog").Logger<import("tslog").ILogObj>;
    readonly fw24: Fw24;
    name: string;
    dependencies: string[];
    output: FW24ConstructOutput;
    mainStack: Stack;
    constructor(certificateConstructConfig: ICertificateConstructConfig);
    construct(): Promise<void>;
}
