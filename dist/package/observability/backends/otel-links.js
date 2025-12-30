"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCausedByLinks = buildCausedByLinks;
const propagation_1 = require("../../core/runtime/execution-context/propagation");
/**
 * Build OTEL SpanLinks for FW24's cross-invocation causation.
 *
 * FW24 contract:
 * - correlationId: local invocation id (slice)
 * - causedBy: upstream invocation correlationId (cross-invocation link)
 *
 * We model causedBy as an OTEL link (NOT parent-child).
 */
function buildCausedByLinks(input) {
    const causedBy = input.causedBy?.trim();
    if (!causedBy)
        return [];
    // Avoid self-linking
    if (causedBy === input.correlationId)
        return [];
    // Best-effort: derive a stable SpanContext from the causedBy correlation id.
    // Note: we do NOT have a real upstream span-id, so we use a stable derived value.
    const context = {
        traceId: (0, propagation_1.toW3CTraceId)(causedBy),
        spanId: (0, propagation_1.toW3CParentId)(causedBy),
        traceFlags: 1, // sampled (best-effort). ADOT/X-Ray will apply its own sampling decisions.
    };
    return [
        {
            context,
            attributes: {
                'fw24.link.kind': 'causedBy',
                'fw24.caused_by': causedBy,
            },
        },
    ];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3RlbC1saW5rcy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9vYnNlcnZhYmlsaXR5L2JhY2tlbmRzL290ZWwtbGlua3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFZQSxnREF3QkM7QUFuQ0Qsa0ZBQStGO0FBRS9GOzs7Ozs7OztHQVFHO0FBQ0gsU0FBZ0Isa0JBQWtCLENBQUMsS0FBbUQ7SUFDcEYsTUFBTSxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQztJQUN4QyxJQUFJLENBQUMsUUFBUTtRQUFFLE9BQU8sRUFBRSxDQUFDO0lBRXpCLHFCQUFxQjtJQUNyQixJQUFJLFFBQVEsS0FBSyxLQUFLLENBQUMsYUFBYTtRQUFFLE9BQU8sRUFBRSxDQUFDO0lBRWhELDZFQUE2RTtJQUM3RSxrRkFBa0Y7SUFDbEYsTUFBTSxPQUFPLEdBQWdCO1FBQzNCLE9BQU8sRUFBRSxJQUFBLDBCQUFZLEVBQUMsUUFBUSxDQUFDO1FBQy9CLE1BQU0sRUFBRSxJQUFBLDJCQUFhLEVBQUMsUUFBUSxDQUFDO1FBQy9CLFVBQVUsRUFBRSxDQUFDLEVBQUUsMkVBQTJFO0tBQzNGLENBQUM7SUFFRixPQUFPO1FBQ0w7WUFDRSxPQUFPO1lBQ1AsVUFBVSxFQUFFO2dCQUNWLGdCQUFnQixFQUFFLFVBQVU7Z0JBQzVCLGdCQUFnQixFQUFFLFFBQVE7YUFDM0I7U0FDRjtLQUNGLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBMaW5rLCBTcGFuQ29udGV4dCB9IGZyb20gJ0BvcGVudGVsZW1ldHJ5L2FwaSc7XG5pbXBvcnQgeyB0b1czQ1BhcmVudElkLCB0b1czQ1RyYWNlSWQgfSBmcm9tICcuLi8uLi9jb3JlL3J1bnRpbWUvZXhlY3V0aW9uLWNvbnRleHQvcHJvcGFnYXRpb24nO1xuXG4vKipcbiAqIEJ1aWxkIE9URUwgU3BhbkxpbmtzIGZvciBGVzI0J3MgY3Jvc3MtaW52b2NhdGlvbiBjYXVzYXRpb24uXG4gKlxuICogRlcyNCBjb250cmFjdDpcbiAqIC0gY29ycmVsYXRpb25JZDogbG9jYWwgaW52b2NhdGlvbiBpZCAoc2xpY2UpXG4gKiAtIGNhdXNlZEJ5OiB1cHN0cmVhbSBpbnZvY2F0aW9uIGNvcnJlbGF0aW9uSWQgKGNyb3NzLWludm9jYXRpb24gbGluaylcbiAqXG4gKiBXZSBtb2RlbCBjYXVzZWRCeSBhcyBhbiBPVEVMIGxpbmsgKE5PVCBwYXJlbnQtY2hpbGQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRDYXVzZWRCeUxpbmtzKGlucHV0OiB7IGNvcnJlbGF0aW9uSWQ6IHN0cmluZzsgY2F1c2VkQnk/OiBzdHJpbmcgfSk6IExpbmtbXSB7XG4gIGNvbnN0IGNhdXNlZEJ5ID0gaW5wdXQuY2F1c2VkQnk/LnRyaW0oKTtcbiAgaWYgKCFjYXVzZWRCeSkgcmV0dXJuIFtdO1xuXG4gIC8vIEF2b2lkIHNlbGYtbGlua2luZ1xuICBpZiAoY2F1c2VkQnkgPT09IGlucHV0LmNvcnJlbGF0aW9uSWQpIHJldHVybiBbXTtcblxuICAvLyBCZXN0LWVmZm9ydDogZGVyaXZlIGEgc3RhYmxlIFNwYW5Db250ZXh0IGZyb20gdGhlIGNhdXNlZEJ5IGNvcnJlbGF0aW9uIGlkLlxuICAvLyBOb3RlOiB3ZSBkbyBOT1QgaGF2ZSBhIHJlYWwgdXBzdHJlYW0gc3Bhbi1pZCwgc28gd2UgdXNlIGEgc3RhYmxlIGRlcml2ZWQgdmFsdWUuXG4gIGNvbnN0IGNvbnRleHQ6IFNwYW5Db250ZXh0ID0ge1xuICAgIHRyYWNlSWQ6IHRvVzNDVHJhY2VJZChjYXVzZWRCeSksXG4gICAgc3BhbklkOiB0b1czQ1BhcmVudElkKGNhdXNlZEJ5KSxcbiAgICB0cmFjZUZsYWdzOiAxLCAvLyBzYW1wbGVkIChiZXN0LWVmZm9ydCkuIEFET1QvWC1SYXkgd2lsbCBhcHBseSBpdHMgb3duIHNhbXBsaW5nIGRlY2lzaW9ucy5cbiAgfTtcblxuICByZXR1cm4gW1xuICAgIHtcbiAgICAgIGNvbnRleHQsXG4gICAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICAgICdmdzI0Lmxpbmsua2luZCc6ICdjYXVzZWRCeScsXG4gICAgICAgICdmdzI0LmNhdXNlZF9ieSc6IGNhdXNlZEJ5LFxuICAgICAgfSxcbiAgICB9LFxuICBdO1xufVxuXG5cbiJdfQ==