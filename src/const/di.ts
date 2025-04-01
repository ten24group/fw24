import { makeDIToken } from '../di/utils';

// DI TOKENS

/**
 * The key for the environment variable that specifies the name of the entry package to import.
 */
export const DYNAMO_ENTITY_CONFIGURATIONS = makeDIToken('DYNAMO_ENTITY_CONFIGURATIONS');
export const DI_CONTAINER = makeDIToken('CURRENT_DI_CONTAINER');
