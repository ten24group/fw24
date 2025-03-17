import { IAuditor } from "../interfaces";

// Dummy Auditor Implementation
export class DummyAuditor implements IAuditor {
    async audit(): Promise<void> {
        // Do nothing
    }
}