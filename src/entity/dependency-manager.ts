import { DIContainer } from "../di";
import { createLogger } from "../logging";
import { EntityAttribute, EntitySchema } from "./base-entity";
import { BaseEntityService } from "./base-service";
import { EntityFilterCriteria } from "./query-types";
import { ExecutionContext } from "../core/types/execution-context";

export interface EntitySubscription {
    dependentEntity: string;
    dependentAttribute: string;
    sourceEntity: string;
    sourceAttribute: string;
    matchBy: Record<string, string>;
    mode: 'sync' | 'async';
}

export class EntityDependencyManager {
    private static readonly logger = createLogger('EntityDependencyManager');
    private static subscriptions: Map<string, EntitySubscription[]> = new Map();
    private static initialized = false;

    /**
     * Initializes the dependency registry by scanning all registered schemas.
     */
    public static initialize() {
        if (this.initialized) return;

        this.logger.info('Initializing Entity Dependency Manager...');
        const schemaProviders = DIContainer.ROOT.collectBestProvidersFor({ type: 'schema' });

        for (const provider of schemaProviders) {
            const entityName = provider._provider.forEntity as string;
            const schema = DIContainer.ROOT.resolveEntitySchema<EntitySchema<any, any, any>>(entityName);

            for (const [attrName, attr] of Object.entries(schema.attributes)) {
                const fwAttr = attr as EntityAttribute;
                if (fwAttr.denormalize) {
                    const sub: EntitySubscription = {
                        dependentEntity: entityName,
                        dependentAttribute: attrName,
                        sourceEntity: fwAttr.denormalize.sourceEntity,
                        sourceAttribute: fwAttr.denormalize.sourceAttribute,
                        matchBy: fwAttr.denormalize.matchBy,
                        mode: fwAttr.denormalize.mode || 'async'
                    };

                    const key = `${sub.sourceEntity}.${sub.sourceAttribute}`;
                    const existing = this.subscriptions.get(key) || [];
                    this.subscriptions.set(key, [...existing, sub]);

                    this.logger.debug(`Registered dependency: ${entityName}.${attrName} subscribes to ${sub.sourceEntity}.${sub.sourceAttribute}`);
                }
            }
        }

        this.initialized = true;
    }

    /**
     * Finds all dependents interested in changes to the specified entity and attributes.
     */
    public static getSubscriptionsFor(entityName: string, changedAttributes: string[]): EntitySubscription[] {
        if (!this.initialized) this.initialize();

        const result: EntitySubscription[] = [];
        for (const attr of changedAttributes) {
            const key = `${entityName}.${attr}`;
            const subs = this.subscriptions.get(key);
            if (subs) {
                result.push(...subs);
            }
        }
        return result;
    }

    /**
     * Propagates changes from a source record to all subscribers.
     */
    public static async propagateChanges(
        sourceEntity: string,
        sourceRecord: any,
        changedAttributes: string[],
        ctx?: ExecutionContext
    ) {
        const subs = this.getSubscriptionsFor(sourceEntity, changedAttributes);
        if (subs.length === 0) return;

        this.logger.info(`Propagating changes for ${sourceEntity} to ${subs.length} subscribers...`);

        for (const sub of subs) {
            try {
                await this.updateSubscriber(sub, sourceRecord, ctx);
            } catch (error) {
                this.logger.error(`Failed to update subscriber ${sub.dependentEntity}.${sub.dependentAttribute}:`, error);
            }
        }
    }

    private static async updateSubscriber(sub: EntitySubscription, sourceRecord: any, ctx?: ExecutionContext) {
        const dependentService = DIContainer.ROOT.resolveEntityService<BaseEntityService<any>>(sub.dependentEntity);
        if (!dependentService) {
            this.logger.warn(`Dependent service ${sub.dependentEntity} not found.`);
            return;
        }

        // Build filters to find dependent records
        const filters: Record<string, any> = {};
        for (const [sourceKey, targetKey] of Object.entries(sub.matchBy)) {
            const val = sourceRecord[sourceKey];
            if (val !== undefined) {
                filters[targetKey] = { eq: val };
            }
        }

        if (Object.keys(filters).length === 0) {
            this.logger.warn(`No match criteria found for subscription ${sub.dependentEntity}.${sub.dependentAttribute}. Skipping.`);
            return;
        }

        // Find all records in dependent entity that need updating
        // TODO: Handle pagination if there are many records
        const queryResult = await dependentService.list({
            filters: filters as EntityFilterCriteria<any>,
            pagination: { count: 100 } // Reasonable batch size
        }, ctx);

        if (queryResult.data && queryResult.data.length > 0) {
            this.logger.debug(`Updating ${queryResult.data.length} records in ${sub.dependentEntity} for ${sub.dependentAttribute}`);

            const newValue = sourceRecord[sub.sourceAttribute];
            const updatePromises = queryResult.data.map((record: any) => {
                const identifiers = dependentService.extractEntityIdentifiers(record);
                return dependentService.executeOperation('update', {
                    identifiers,
                    data: { [sub.dependentAttribute]: newValue }
                }, ctx);
            });

            await Promise.all(updatePromises);
        }
    }
}
