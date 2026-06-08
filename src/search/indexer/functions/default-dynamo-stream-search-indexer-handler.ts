import { DynamoDBStreamSearchIndexer } from "../dynamo-stream-search-indexer";

/**
 * Default search indexer handler export for framework usage
 */
export const handler = DynamoDBStreamSearchIndexer.CreateHandler(DynamoDBStreamSearchIndexer); 