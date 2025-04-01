import { FrameworkError } from '../../errors';

export class NoEntityServiceProviderError extends FrameworkError {
  constructor(entityName: string, containerId: string) {
    super(`No Entity-Service provider found for entity- ${entityName}. DIContainer[${containerId}]`);
  }
}
