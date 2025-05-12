import { IAuditLogger, AuditOptions } from "../interfaces";

/**
 * A no-op auditor implementation that does nothing.
 * Used as a fallback when auditing is disabled.
 */
export class DummyAuditLogger implements IAuditLogger {
    constructor() {}

    async audit(options: AuditOptions): Promise<void> {
        options;
        // Do nothing
    }
}