import { BaseEntityService, Service, Inject, DI_TOKENS } from '@ten24group/fw24';
import { ProductEntity } from '../entities/product';
import type { EntityConfiguration } from 'electrodb';

@Service()
export class ProductService extends BaseEntityService<typeof ProductEntity> {
    constructor(
        @Inject(DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS) config: EntityConfiguration
    ) {
        super(ProductEntity, config);
    }

    async getProduct(id: string) {
        return this.get({ identifiers: { id } });
    }
}
