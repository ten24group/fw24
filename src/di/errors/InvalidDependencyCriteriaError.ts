import { FrameworkError } from '../../errors';

export class InvalidDependencyCriteriaError extends FrameworkError {
  constructor(criteria: any) {
    super(`Invalid dependency criteria ${JSON.stringify(criteria)}`);
  }
}
