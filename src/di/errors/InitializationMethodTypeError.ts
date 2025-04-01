import { FrameworkError } from '../../errors';

export class InitializationMethodTypeError extends FrameworkError {
  constructor(initMethod: string, instanceName: string, containerId: string) {
    super(`Initialization method ${initMethod} is not a function on ${instanceName}. DIContainer[${containerId}]`);
  }
}
