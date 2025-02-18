import { Helper } from "../core/helper";
import { Fw24 } from "../core/fw24";
import { FW24Construct, FW24ConstructOutput, OutputType } from "../interfaces/construct";
import { LogDuration, createLogger } from "../logging";
import { CfnOutput, Stack } from "aws-cdk-lib";
import { Certificate, CertificateValidation, ICertificate } from "aws-cdk-lib/aws-certificatemanager";

/**
 * Represents the configuration for a certificate construct.
 */
export interface ICertificateConstructConfig {
    domainName: string;
    certificateArn?: string;
}

export class CertificateConstruct implements FW24Construct {
    readonly logger = createLogger(CertificateConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = CertificateConstruct.name;
    dependencies: string[] = [];
    output!: FW24ConstructOutput;

    mainStack!: Stack;

    constructor(private certificateConstructConfig: ICertificateConstructConfig) {
        Helper.hydrateConfig(certificateConstructConfig,'ACM');
    }

    public async construct() {
        this.mainStack = this.fw24.getStack('main');

        let certificate: any;
        if (this.certificateConstructConfig.certificateArn){
            certificate = Certificate.fromCertificateArn(this.mainStack, this.fw24.appName + this.certificateConstructConfig.domainName + '-certificate', this.certificateConstructConfig.certificateArn);
        } else if(!this.certificateConstructConfig.certificateArn){
            certificate = new Certificate(this.mainStack, this.fw24.appName + this.certificateConstructConfig.domainName + '-certificate', {
                domainName: this.certificateConstructConfig.domainName,
                validation: CertificateValidation.fromDns(),
            });
        } 
        this.fw24.setConstructOutput(this, this.certificateConstructConfig.domainName, certificate, OutputType.CERTIFICATE);

    }
}   