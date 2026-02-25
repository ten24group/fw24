import { DIContainer, DI_TOKENS, LayerEntry } from '@ten24group/fw24';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

@LayerEntry({
    layerName: 'di-layer',
    isEntryPackage: true
})
export class DiLayer {}

const container = DIContainer.ROOT;

container.register({
    provide: DI_TOKENS.DYNAMO_ENTITY_CONFIGURATIONS,
    useFactory: () => {
        const client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
            endpoint: process.env.AWS_ENDPOINT_URL_DYNAMODB
        });
        return {
            // The framework injects this when using resourceAccess: { tables: ['store-table'] }
            table: process.env.STORE_TABLE_TABLE,
            client: DynamoDBDocumentClient.from(client, {
                marshallOptions: { removeUndefinedValues: true }
            })
        };
    }
});
