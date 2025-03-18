import { IAuditor, AuditOptions } from "../interfaces";

/**
 * A no-op auditor implementation that does nothing.
 * Used as a fallback when auditing is disabled.
 */
export class DummyAuditor implements IAuditor {
    constructor() {}

    async audit(options: AuditOptions): Promise<void> {
        options;
        // Do nothing
    }
}