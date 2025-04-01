import { FrameworkError } from '../../errors';

export class InitializationMethodError extends FrameworkError {
  constructor(instanceName: string, errorMessage: string, containerId: string) {
    super(`Initialization method failed for ${instanceName}: ${errorMessage}. DIContainer[${containerId}]`);
  }
}
