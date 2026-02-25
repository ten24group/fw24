import * as fs from 'node:fs';
import * as path from 'node:path';
import { createLogger } from '../../logging';

export interface SimulatedLambda {
    id: string;
    handler: string;
    runtime: string;
    codePath: string;
    environment: Record<string, string>;
}

export interface SimulatedApiRoute {
    method: string;
    path: string;
    lambdaId: string;
    authorizer?: {
        type: string;
        groups?: string[];
    };
}

export interface SimulatedResource {
    id: string;
    type: string;
    properties: any;
}

export interface SimulatedSqsSubscription {
    queueName: string;
    lambdaId: string;
}

export class CDKParser {
    private readonly logger = createLogger(CDKParser.name);
    private readonly cdkOutDir: string;
    private resourceMap: Record<string, any> = {};

    constructor(cdkOutDir: string = 'cdk.out') {
        this.cdkOutDir = path.resolve(cdkOutDir);
    }

    parse(): {
        lambdas: SimulatedLambda[],
        routes: SimulatedApiRoute[],
        resources: SimulatedResource[],
        events: any[],
        subscriptions: any[],
        sqsSubscriptions: SimulatedSqsSubscription[],
        s3Notifications: any[]
    } {
        const manifestPath = path.join(this.cdkOutDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`CDK manifest not found at ${manifestPath}. This usually means 'cdk synth' failed or was not run in the project root.`);
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const lambdas: SimulatedLambda[] = [];
        const routes: SimulatedApiRoute[] = [];
        const resources: SimulatedResource[] = [];
        const events: any[] = [];
        const subscriptions: any[] = [];
        const sqsSubscriptions: SimulatedSqsSubscription[] = [];

        // First pass: build global resource map across all stacks
        for (const [ artifactId, artifact ] of Object.entries<any>(manifest.artifacts)) {
            if (artifact.type === 'aws:cloudformation:stack') {
                const templatePath = path.join(this.cdkOutDir, artifact.properties.templateFile);
                if (fs.existsSync(templatePath)) {
                    const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
                    Object.assign(this.resourceMap, template.Resources || {});
                }
            }
        }

        // Second pass: extract data
        for (const [ id, resource ] of Object.entries<any>(this.resourceMap)) {
            if (resource.Type === 'AWS::Lambda::Function') {
                lambdas.push({
                    id,
                    handler: resource.Properties.Handler,
                    runtime: resource.Properties.Runtime,
                    codePath: this.resolveCodePath(resource),
                    environment: this.resolveEnvironment(resource.Properties.Environment)
                });
            } else if (resource.Type === 'AWS::ApiGateway::Method') {
                const route = this.resolveRoute(id, resource);
                if (route) routes.push(route);
            } else if (resource.Type === 'AWS::Events::Rule') {
                events.push({
                    id,
                    schedule: resource.Properties.ScheduleExpression,
                    targets: this.resolveProperties(resource.Properties.Targets)
                });
            } else if (resource.Type === 'AWS::SNS::Subscription') {
                subscriptions.push({
                    id,
                    topicArn: this.resolveIntrinsic(resource.Properties.TopicArn),
                    endpoint: this.resolveIntrinsic(resource.Properties.Endpoint),
                    protocol: resource.Properties.Protocol
                });
            } else if (resource.Type === 'AWS::Lambda::EventSourceMapping') {
                const sourceArn = this.resolveIntrinsic(resource.Properties.EventSourceArn);
                if (sourceArn.includes(':sqs:')) {
                    sqsSubscriptions.push({
                        queueName: sourceArn.split(':').pop(),
                        lambdaId: this.resolveIntrinsic(resource.Properties.FunctionName)
                    });
                }
            } else if (['AWS::DynamoDB::Table', 'AWS::SQS::Queue', 'AWS::S3::Bucket', 'AWS::SNS::Topic'].includes(resource.Type)) {
                resources.push({
                    id,
                    type: resource.Type,
                    properties: this.resolveProperties(resource.Properties)
                });
            }
        }

        return {
            lambdas,
            routes,
            resources,
            events,
            subscriptions,
            sqsSubscriptions,
            s3Notifications: this.extractS3Notifications()
        };
    }

    private extractS3Notifications(): any[] {
        const notifications: any[] = [];
        for (const [ id, resource ] of Object.entries<any>(this.resourceMap)) {
            if (resource.Type === 'AWS::S3::Bucket') {
                const config = resource.Properties.NotificationConfiguration;
                if (config) {
                    if (config.LambdaConfigurations) {
                        for (const conf of config.LambdaConfigurations) {
                            notifications.push({
                                bucketName: this.resolveIntrinsic({ Ref: id }),
                                event: conf.Event,
                                filter: conf.Filter,
                                targetLambdaId: this.resolveIntrinsic(conf.Function)
                            });
                        }
                    }
                }
            }
        }
        return notifications;
    }

    private resolveCodePath(resource: any): string {
        const assetPath = resource.Metadata?.['aws:asset:path'];
        if (assetPath) {
            return path.join(this.cdkOutDir, assetPath);
        }
        return '';
    }

    private resolveEnvironment(env: any): Record<string, string> {
        const result: Record<string, string> = {};
        if (env && env.Variables) {
            for (const [ k, v ] of Object.entries<any>(env.Variables)) {
                result[ k ] = this.resolveIntrinsic(v);
            }
        }
        return result;
    }

    private resolveProperties(props: any): any {
        if (typeof props !== 'object' || props === null) return props;
        if (Array.isArray(props)) return props.map(p => this.resolveProperties(p));

        const result: any = {};
        for (const [ k, v ] of Object.entries(props)) {
            if (k.startsWith('Fn::') || k === 'Ref') {
                return this.resolveIntrinsic(props);
            }
            result[ k ] = this.resolveProperties(v);
        }
        return result;
    }

    private resolveIntrinsic(val: any): any {
        if (typeof val !== 'object' || val === null) return String(val);

        if (val.Ref) {
            const ref = val.Ref;
            if (this.resourceMap[ ref ]) {
                const target = this.resourceMap[ ref ];
                // Return physical name if possible
                return target.Properties?.TableName || target.Properties?.QueueName || target.Properties?.BucketName || target.Properties?.UserPoolName || ref;
            }
            return ref;
        }

        if (val['Fn::Join']) {
            const [ sep, parts ] = val['Fn::Join'];
            return parts.map((p: any) => this.resolveIntrinsic(p)).join(sep);
        }

        if (val['Fn::GetAtt']) {
            const [ ref, attr ] = val['Fn::GetAtt'];
            const target = this.resourceMap[ ref ];
            if (attr === 'Arn') {
                 const name = target?.Properties?.TableName || target?.Properties?.QueueName || target?.Properties?.BucketName || target?.Properties?.UserPoolName || ref;
                 const service = target?.Type?.split('::')[1]?.toLowerCase() || 'service';
                 return `arn:aws:${service}:local:123456789012:${name}`;
            }
            if (target?.Properties?.[attr]) {
                return this.resolveIntrinsic(target.Properties[attr]);
            }
            return ref;
        }

        if (val['Fn::Sub']) {
            let template = val['Fn::Sub'];
            let mapping: any = {};
            if (Array.isArray(template)) {
                mapping = template[1] || {};
                template = template[0];
            }
            return template.replace(/\${([^}]+)}/g, (_match: string, p1: string) => {
                if (mapping[p1]) return this.resolveIntrinsic(mapping[p1]);
                return this.resolveIntrinsic({ Ref: p1 });
            });
        }

        if (val['Fn::ImportValue']) {
            // In a local simulation across stacks, we've merged all resources into resourceMap.
            // If the export name matches a logical ID or a physical name we can find, resolve it.
            // However, often Fn::ImportValue uses the ExportName from CfnOutput.
            return val['Fn::ImportValue'];
        }

        return JSON.stringify(val);
    }

    private resolveRoute(_methodId: string, methodResource: any): SimulatedApiRoute | null {
        const props = methodResource.Properties;
        const uri = props.Integration?.Uri;
        let lambdaId = '';

        if (uri) {
            // Usually Fn::Join or Ref to the Lambda function
            const uriStr = JSON.stringify(uri);
            // Search for all Refs and GetAtts and pick one that is a Lambda function in our resource map
            const matches = uriStr.matchAll(/"(?:Ref|Fn::GetAtt)":\[?"([^"\]]+)"/g);
            for (const match of matches) {
                const id = match[1];
                if (this.resourceMap[id]?.Type === 'AWS::Lambda::Function') {
                    lambdaId = id;
                    break;
                }
            }
        }

        let routePath = '';
        let currentResourceId = props.ResourceId?.Ref || props.ResourceId;
        while (currentResourceId) {
            const resourceId = typeof currentResourceId === 'object' ? currentResourceId.Ref : currentResourceId;
            const res = this.resourceMap[ resourceId ];
            if (res && res.Properties) {
                if (res.Properties.PathPart) {
                    routePath = '/' + res.Properties.PathPart + routePath;
                }
                currentResourceId = res.Properties.ParentId?.Ref || res.Properties.ParentId;
            } else {
                break;
            }
        }

        // Extract Authorization
        const authorizer: any = {
            type: props.AuthorizationType || 'NONE'
        };

        if (props.AuthorizerId) {
            const authId = typeof props.AuthorizerId === 'object' ? props.AuthorizerId.Ref : props.AuthorizerId;
            const authRes = this.resourceMap[ authId ];
            if (authRes) {
                authorizer.name = authRes.Properties.Name;
                authorizer.type = authRes.Properties.Type;
            }
        }

        return {
            method: props.HttpMethod,
            path: routePath || '/',
            lambdaId,
            authorizer: authorizer.type !== 'NONE' ? authorizer : undefined
        };
    }
}
