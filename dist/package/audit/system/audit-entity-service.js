"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamoDBAuditEntityService = void 0;
const decorators_1 = require("../../decorators");
const entity_1 = require("../../entity");
const dynamodb_1 = require("../loggers/dynamodb");
let DynamoDBAuditEntityService = class DynamoDBAuditEntityService extends entity_1.BaseEntityService {
    constructor() {
        super(dynamodb_1.DynamoDBAuditEntitySchema, dynamodb_1.DynamoDBAuditEntityConfiguration);
    }
    /**
     * Override the base list method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Uses GSI3 index for chronological sorting by timestampMs
     */
    async list(query = {}, ctx) {
        // Set default order to 'desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery = {
            ...query,
            pagination: {
                ...query.pagination,
                order: 'desc'
            },
            // Use GSI3 index for chronological sorting
            // GSI3: PK = auditType (constant 'audit'), SK = timestampMs
            // This allows sorting all audit logs chronologically
            index: {
                name: 'gsi3',
                filters: {
                    auditType: 'audit'
                }
            }
        };
        return super.list(modifiedQuery, ctx);
    }
};
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService;
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService = __decorate([
    (0, decorators_1.Service)()
], DynamoDBAuditEntityService);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtZW50aXR5LXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL2F1ZGl0LWVudGl0eS1zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLGlEQUEyQztBQUMzQyx5Q0FBOEQ7QUFFOUQsa0RBQXlIO0FBR2xILElBQU0sMEJBQTBCLEdBQWhDLE1BQU0sMEJBQTJCLFNBQVEsMEJBQXdDO0lBQ3BGO1FBQ0ksS0FBSyxDQUFDLG9DQUF5QixFQUFFLDJDQUFnQyxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQTRDLEVBQUUsRUFBRSxHQUFzQjtRQUNwRixrRUFBa0U7UUFDbEUsK0NBQStDO1FBQy9DLE1BQU0sYUFBYSxHQUFHO1lBQ2xCLEdBQUcsS0FBSztZQUNSLFVBQVUsRUFBRTtnQkFDUixHQUFHLEtBQUssQ0FBQyxVQUFVO2dCQUNuQixLQUFLLEVBQUUsTUFBZTthQUN6QjtZQUNELDJDQUEyQztZQUMzQyw0REFBNEQ7WUFDNUQscURBQXFEO1lBQ3JELEtBQUssRUFBRTtnQkFDSCxJQUFJLEVBQUUsTUFBTTtnQkFDWixPQUFPLEVBQUU7b0JBQ0wsU0FBUyxFQUFFLE9BQU87aUJBQ3JCO2FBQ0o7U0FDSixDQUFDO1FBRUYsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUMxQyxDQUFDO0NBQ0osQ0FBQTtBQWhDWSxnRUFBMEI7cUNBQTFCLDBCQUEwQjtJQUR0QyxJQUFBLG9CQUFPLEdBQUU7R0FDRywwQkFBMEIsQ0FnQ3RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmljZSB9IGZyb20gJy4uLy4uL2RlY29yYXRvcnMnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIEVudGl0eVF1ZXJ5IH0gZnJvbSAnLi4vLi4vZW50aXR5JztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEsIER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uLCBBdWRpdEVudGl0eVNjaGVtYVR5cGUgfSBmcm9tICcuLi9sb2dnZXJzL2R5bmFtb2RiJztcblxuQFNlcnZpY2UoKVxuZXhwb3J0IGNsYXNzIER5bmFtb0RCQXVkaXRFbnRpdHlTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8QXVkaXRFbnRpdHlTY2hlbWFUeXBlPiB7XG4gICAgY29uc3RydWN0b3IoKSB7XG4gICAgICAgIHN1cGVyKER5bmFtb0RCQXVkaXRFbnRpdHlTY2hlbWEsIER5bmFtb0RCQXVkaXRFbnRpdHlDb25maWd1cmF0aW9uKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBPdmVycmlkZSB0aGUgYmFzZSBsaXN0IG1ldGhvZCB0byByZXR1cm4gbGF0ZXN0IGF1ZGl0IHJlY29yZHMgZmlyc3RcbiAgICAgKiBUaGlzIGVuc3VyZXMgYXVkaXQgbG9ncyBhcmUgZGlzcGxheWVkIHdpdGggbW9zdCByZWNlbnQgZW50cmllcyBhdCB0aGUgdG9wXG4gICAgICogVXNlcyBHU0kzIGluZGV4IGZvciBjaHJvbm9sb2dpY2FsIHNvcnRpbmcgYnkgdGltZXN0YW1wTXNcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgbGlzdChxdWVyeTogRW50aXR5UXVlcnk8QXVkaXRFbnRpdHlTY2hlbWFUeXBlPiA9IHt9LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIC8vIFNldCBkZWZhdWx0IG9yZGVyIHRvICdkZXNjJyBmb3IgYXVkaXQgbG9ncyB0byBzaG93IGxhdGVzdCBmaXJzdFxuICAgICAgICAvLyBBbGxvdyBvdmVycmlkZSB2aWEgcXVlcnkgcGFyYW1ldGVyIGlmIG5lZWRlZFxuICAgICAgICBjb25zdCBtb2RpZmllZFF1ZXJ5ID0ge1xuICAgICAgICAgICAgLi4ucXVlcnksXG4gICAgICAgICAgICBwYWdpbmF0aW9uOiB7XG4gICAgICAgICAgICAgICAgLi4ucXVlcnkucGFnaW5hdGlvbixcbiAgICAgICAgICAgICAgICBvcmRlcjogJ2Rlc2MnIGFzIGNvbnN0XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLy8gVXNlIEdTSTMgaW5kZXggZm9yIGNocm9ub2xvZ2ljYWwgc29ydGluZ1xuICAgICAgICAgICAgLy8gR1NJMzogUEsgPSBhdWRpdFR5cGUgKGNvbnN0YW50ICdhdWRpdCcpLCBTSyA9IHRpbWVzdGFtcE1zXG4gICAgICAgICAgICAvLyBUaGlzIGFsbG93cyBzb3J0aW5nIGFsbCBhdWRpdCBsb2dzIGNocm9ub2xvZ2ljYWxseVxuICAgICAgICAgICAgaW5kZXg6IHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnZ3NpMycsXG4gICAgICAgICAgICAgICAgZmlsdGVyczoge1xuICAgICAgICAgICAgICAgICAgICBhdWRpdFR5cGU6ICdhdWRpdCdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHN1cGVyLmxpc3QobW9kaWZpZWRRdWVyeSwgY3R4KTtcbiAgICB9XG59XG4iXX0=