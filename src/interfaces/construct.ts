import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Fw24 } from "../core/fw24";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Role } from "aws-cdk-lib/aws-iam";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Vpc, ISubnet, ISecurityGroup} from "aws-cdk-lib/aws-ec2";
import { LayerVersion } from "aws-cdk-lib/aws-lambda";
import { CfnIdentityPool, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import { CloudFrontWebDistribution } from "aws-cdk-lib/aws-cloudfront";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";

export interface FW24Construct {
    name: string;
    dependencies: string[];
    fw24: Fw24;
    construct(): Promise<void>;
    // outputs from the stack that can be used by other stacks
    // convention for output is to use the resource and name as the key
    // e.g. output: bucket.[bucketName] = bucket; function.[functionName] = function
    output: FW24ConstructOutput;
}

export interface FW24ConstructOutput extends Record<string, any>{
    [OutputType.FUNCTION]: Record<string,NodejsFunction>;
    [OutputType.BUCKET]: Record<string,Bucket>;
    [OutputType.QUEUE]: Record<string,Queue>;
    [OutputType.TABLE]: Record<string,any>;
    [OutputType.ROLE]: Record<string,Role>;
    [OutputType.TOPIC]: Record<string,Topic>;
    [OutputType.LAYER]: Record<string,LayerVersion>;
    [OutputType.API]: Record<string,any>;
    [OutputType.ENDPOINT]:Record<string,any>;
    [OutputType.USERPOOL]: Record<string,UserPool>;
    [OutputType.IDENTITYPOOL]: Record<string,CfnIdentityPool>;
    [OutputType.USERPOOLCLIENT]: Record<string,UserPoolClient>;
    [OutputType.VPC]: Record<string,Vpc>;
    [OutputType.SUBNET]: Record<string,ISubnet>;
    [OutputType.SUBNETS]: Record<string,ISubnet[]>;
    [OutputType.SECURITYGROUP]: Record<string,ISecurityGroup>;
    [OutputType.CLOUDFRONTWEBDISTRIBUTION]: Record<string,CloudFrontWebDistribution>;
    [OutputType.CERTIFICATE]: Record<string,ICertificate>;
    [key: string]: any;
}

export enum OutputType   {
    FUNCTION = 'function',
    BUCKET = 'bucket',
    QUEUE = 'queue',
    TABLE = 'table',
    ROLE = 'role',
    TOPIC = 'topic',
    LAYER = 'layer',
    API = 'api',
    ENDPOINT = 'endpoint',
    USERPOOL = 'userpool',
    IDENTITYPOOL = 'identitypool',
    USERPOOLCLIENT = 'userpoolclient',
    VPC = 'vpc',
    SUBNET = 'subnet',
    SUBNETS = 'subnets',
    SECURITYGROUP = 'securitygroup',
    CLOUDFRONTWEBDISTRIBUTION = 'cloudfrontwebdistribution',
    CERTIFICATE = 'certificate',
}