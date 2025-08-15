import { IAuditLogger, AuditOptions } from "../interfaces";
/**
 * A no-op auditor implementation that does nothing.
 * Used as a fallback when auditing is disabled.
 */
export declare class DummyAuditLogger implements IAuditLogger {
    constructor();
    audit(_options: AuditOptions): Promise<void>;
}
