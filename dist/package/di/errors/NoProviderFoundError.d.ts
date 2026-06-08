import { FrameworkError } from '../../errors';
import { IDIContainer } from '../../interfaces';
export declare class NoProviderFoundError extends FrameworkError {
    constructor(token: string, container: IDIContainer, criteria?: any);
}
