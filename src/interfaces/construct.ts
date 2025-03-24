import type { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import type { CloudFrontWebDistribution } from "aws-cdk-lib/aws-cloudfront";
import type { CfnIdentityPool, UserPool, UserPoolClient } from "aws-cdk-lib/aws-cognito";
import type { ISecurityGroup, ISubnet, Vpc } from "aws-cdk-lib/aws-ec2";
import type { Role } from "aws-cdk-lib/aws-iam";
import type { LayerVersion } from "aws-cdk-lib/aws-lambda";
import type { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Bucket } from "aws-cdk-lib/aws-s3";
import type { Topic } from "aws-cdk-lib/aws-sns";
import type { Queue } from "aws-cdk-lib/aws-sqs";
import type { FargateService, ICluster } from "aws-cdk-lib/aws-ecs";
import type { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import type { Service } from "aws-cdk-lib/aws-servicediscovery";
import type { FileSystem } from "aws-cdk-lib/aws-efs";

import type { Fw24 } from "../core/fw24";
import { Stack } from "aws-cdk-lib";

export interface FW24Construct {
    name: string;
    dependencies: string[];
    fw24: Fw24;
    construct(): Promise<void>;
    // outputs from the stack that can be used by other stacks
    // convention for output is to use the resource and name as the key
    // e.g. output: bucket.[bucketName] = bucket; function.[functionName] = function
    output: FW24ConstructOutput;
    mainStack: Stack
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
    [OutputType.SERVICE]: Record<string,FargateService>;
    [OutputType.LOADBALANCER]: Record<string,ApplicationLoadBalancer>;
    [OutputType.SERVICE_DISCOVERY]: Record<string,Service>;
    [OutputType.CLUSTER]: Record<string,ICluster>;
    [OutputType.EFS]: Record<string,FileSystem>;
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
    SERVICE = 'service',
    LOADBALANCER = 'loadbalancer',
    SERVICE_DISCOVERY = 'servicediscovery',
    CLUSTER = 'cluster',
    EFS = 'efs'
}