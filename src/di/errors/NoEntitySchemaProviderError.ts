import { FrameworkError } from '../../errors';

export class NoEntitySchemaProviderError extends FrameworkError {
  constructor(entityName: string, containerId: string) {
    super(`No Entity-Schema provider found for entity- ${entityName}. DIContainer[${containerId}]`);
  }
}
