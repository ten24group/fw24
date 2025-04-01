import { FrameworkError } from '../../errors';
import { IDIContainer } from '../../interfaces';

export class NoProviderFoundError extends FrameworkError {
  constructor(token: string, container: IDIContainer, criteria: any = {}) {
    super(`No provider found for ${token}`, { criteria, container: container.containerId });
  }
}
