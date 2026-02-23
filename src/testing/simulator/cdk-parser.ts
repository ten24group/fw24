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
}

export interface SimulatedResource {
    id: string;
    type: string;
    properties: any;
}

export class CDKParser {
    private readonly logger = createLogger(CDKParser.name);
    private readonly cdkOutDir: string;

    constructor(cdkOutDir: string = 'cdk.out') {
        this.cdkOutDir = path.resolve(cdkOutDir);
    }

    parse(): { lambdas: SimulatedLambda[], routes: SimulatedApiRoute[], resources: SimulatedResource[] } {
        const manifestPath = path.join(this.cdkOutDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`Manifest not found at ${manifestPath}`);
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const lambdas: SimulatedLambda[] = [];
        const routes: SimulatedApiRoute[] = [];
        const resources: SimulatedResource[] = [];

        for (const [ artifactId, artifact ] of Object.entries<any>(manifest.artifacts)) {
            if (artifact.type === 'aws:cloudformation:stack') {
                const templatePath = path.join(this.cdkOutDir, artifact.properties.templateFile);
                const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
                this.parseTemplate(template, lambdas, routes, resources);
            }
        }

        return { lambdas, routes, resources };
    }

    private parseTemplate(template: any, lambdas: SimulatedLambda[], routes: SimulatedApiRoute[], resources: SimulatedResource[]) {
        const resourceMap = template.Resources || {};

        for (const [ id, resource ] of Object.entries<any>(resourceMap)) {
            if (resource.Type === 'AWS::Lambda::Function') {
                lambdas.push({
                    id,
                    handler: resource.Properties.Handler,
                    runtime: resource.Properties.Runtime,
                    codePath: this.resolveCodePath(resource),
                    environment: this.resolveEnvironment(resource.Properties.Environment)
                });
            } else if (resource.Type === 'AWS::ApiGateway::Method') {
                // Simplified route parsing - real logic would involve tracing Method -> Resource -> RestApi
                const route = this.resolveRoute(id, resource, resourceMap);
                if (route) routes.push(route);
            } else {
                resources.push({
                    id,
                    type: resource.Type,
                    properties: resource.Properties
                });
            }
        }
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
                if (typeof v === 'string') {
                    result[ k ] = v;
                } else {
                    // Handle references, but for simulator we might just put a placeholder
                    result[ k ] = JSON.stringify(v);
                }
            }
        }
        return result;
    }

    private resolveRoute(methodId: string, methodResource: any, resourceMap: any): SimulatedApiRoute | null {
        // Tracing through Method -> Resource -> path
        // Trace the URI to find the Lambda ARN/ID
        const uri = methodResource.Properties.Integration?.Uri;
        let lambdaId = '';
        if (uri) {
            // Simplified extraction of Lambda Ref from URI
            const match = JSON.stringify(uri).match(/"Ref":"([^"]+)"/);
            if (match) {
                lambdaId = match[ 1 ];
            }
        }

        // Trace up to get the full path
        let path = '';
        let currentResourceId = methodResource.Properties.ResourceId.Ref;
        while (currentResourceId) {
            const res = resourceMap[ currentResourceId ];
            if (res && res.Properties && res.Properties.PathPart) {
                path = '/' + res.Properties.PathPart + path;
                currentResourceId = res.Properties.ParentId?.Ref;
            } else {
                break;
            }
        }

        return {
            method: methodResource.Properties.HttpMethod,
            path: path || '/',
            lambdaId
        };
    }
}
