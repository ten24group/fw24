import {  } from "aws-cdk-lib/aws-ses";

export interface ISESConfig {
    domain: string;
    sesOptions?: {};
}
