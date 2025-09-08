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
    /**
     * Override the base search method to return latest audit records first
     * This ensures audit logs are displayed with most recent entries at the top
     * Adds default sorting by timestamp in descending order when no sort is specified
     */
    async search(query, ctx) {
        // Set default sort to 'timestamp:desc' for audit logs to show latest first
        // Allow override via query parameter if needed
        const modifiedQuery = {
            ...query,
            // Only add default sort if no sort is specified
            sort: query.sort && query.sort.length > 0
                ? query.sort
                : [{ field: 'timestamp', dir: 'desc' }]
        };
        return super.search(modifiedQuery, ctx);
    }
};
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService;
exports.DynamoDBAuditEntityService = DynamoDBAuditEntityService = __decorate([
    (0, decorators_1.Service)()
], DynamoDBAuditEntityService);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXVkaXQtZW50aXR5LXNlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvYXVkaXQvc3lzdGVtL2F1ZGl0LWVudGl0eS1zZXJ2aWNlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7OztBQUFBLGlEQUEyQztBQUMzQyx5Q0FBOEQ7QUFHOUQsa0RBQXlIO0FBR2xILElBQU0sMEJBQTBCLEdBQWhDLE1BQU0sMEJBQTJCLFNBQVEsMEJBQXdDO0lBQ3BGO1FBQ0ksS0FBSyxDQUFDLG9DQUF5QixFQUFFLDJDQUFnQyxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQTRDLEVBQUUsRUFBRSxHQUFzQjtRQUNwRixrRUFBa0U7UUFDbEUsK0NBQStDO1FBQy9DLE1BQU0sYUFBYSxHQUFHO1lBQ2xCLEdBQUcsS0FBSztZQUNSLFVBQVUsRUFBRTtnQkFDUixHQUFHLEtBQUssQ0FBQyxVQUFVO2dCQUNuQixLQUFLLEVBQUUsTUFBZTthQUN6QjtZQUNELDJDQUEyQztZQUMzQyw0REFBNEQ7WUFDNUQscURBQXFEO1lBQ3JELEtBQUssRUFBRTtnQkFDSCxJQUFJLEVBQUUsTUFBTTtnQkFDWixPQUFPLEVBQUU7b0JBQ0wsU0FBUyxFQUFFLE9BQU87aUJBQ3JCO2FBQ0o7U0FDSixDQUFDO1FBRUYsT0FBTyxLQUFLLENBQUMsSUFBSSxDQUFDLGFBQWEsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLEtBQUssQ0FBQyxNQUFNLENBQUMsS0FBK0MsRUFBRSxHQUFzQjtRQUN2RiwyRUFBMkU7UUFDM0UsK0NBQStDO1FBQy9DLE1BQU0sYUFBYSxHQUE2QztZQUM1RCxHQUFHLEtBQUs7WUFDUixnREFBZ0Q7WUFDaEQsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQztnQkFDckMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxJQUFJO2dCQUNaLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxFQUFFLFdBQW9CLEVBQUUsR0FBRyxFQUFFLE1BQWUsRUFBRSxDQUFDO1NBQ2hFLENBQUM7UUFFRixPQUFPLEtBQUssQ0FBQyxNQUFNLENBQUMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQzVDLENBQUM7Q0FDSixDQUFBO0FBbkRZLGdFQUEwQjtxQ0FBMUIsMEJBQTBCO0lBRHRDLElBQUEsb0JBQU8sR0FBRTtHQUNHLDBCQUEwQixDQW1EdEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vZGVjb3JhdG9ycyc7XG5pbXBvcnQgeyBCYXNlRW50aXR5U2VydmljZSwgRW50aXR5UXVlcnkgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgRXhlY3V0aW9uQ29udGV4dCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMvZXhlY3V0aW9uLWNvbnRleHQnO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoUXVlcnkgfSBmcm9tICcuLi8uLi9zZWFyY2gvdHlwZXMnO1xuaW1wb3J0IHsgRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSwgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24sIEF1ZGl0RW50aXR5U2NoZW1hVHlwZSB9IGZyb20gJy4uL2xvZ2dlcnMvZHluYW1vZGInO1xuXG5AU2VydmljZSgpXG5leHBvcnQgY2xhc3MgRHluYW1vREJBdWRpdEVudGl0eVNlcnZpY2UgZXh0ZW5kcyBCYXNlRW50aXR5U2VydmljZTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+IHtcbiAgICBjb25zdHJ1Y3RvcigpIHtcbiAgICAgICAgc3VwZXIoRHluYW1vREJBdWRpdEVudGl0eVNjaGVtYSwgRHluYW1vREJBdWRpdEVudGl0eUNvbmZpZ3VyYXRpb24pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE92ZXJyaWRlIHRoZSBiYXNlIGxpc3QgbWV0aG9kIHRvIHJldHVybiBsYXRlc3QgYXVkaXQgcmVjb3JkcyBmaXJzdFxuICAgICAqIFRoaXMgZW5zdXJlcyBhdWRpdCBsb2dzIGFyZSBkaXNwbGF5ZWQgd2l0aCBtb3N0IHJlY2VudCBlbnRyaWVzIGF0IHRoZSB0b3BcbiAgICAgKiBVc2VzIEdTSTMgaW5kZXggZm9yIGNocm9ub2xvZ2ljYWwgc29ydGluZyBieSB0aW1lc3RhbXBNc1xuICAgICAqL1xuICAgIHB1YmxpYyBhc3luYyBsaXN0KHF1ZXJ5OiBFbnRpdHlRdWVyeTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+ID0ge30sIGN0eD86IEV4ZWN1dGlvbkNvbnRleHQpIHtcbiAgICAgICAgLy8gU2V0IGRlZmF1bHQgb3JkZXIgdG8gJ2Rlc2MnIGZvciBhdWRpdCBsb2dzIHRvIHNob3cgbGF0ZXN0IGZpcnN0XG4gICAgICAgIC8vIEFsbG93IG92ZXJyaWRlIHZpYSBxdWVyeSBwYXJhbWV0ZXIgaWYgbmVlZGVkXG4gICAgICAgIGNvbnN0IG1vZGlmaWVkUXVlcnkgPSB7XG4gICAgICAgICAgICAuLi5xdWVyeSxcbiAgICAgICAgICAgIHBhZ2luYXRpb246IHtcbiAgICAgICAgICAgICAgICAuLi5xdWVyeS5wYWdpbmF0aW9uLFxuICAgICAgICAgICAgICAgIG9yZGVyOiAnZGVzYycgYXMgY29uc3RcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvLyBVc2UgR1NJMyBpbmRleCBmb3IgY2hyb25vbG9naWNhbCBzb3J0aW5nXG4gICAgICAgICAgICAvLyBHU0kzOiBQSyA9IGF1ZGl0VHlwZSAoY29uc3RhbnQgJ2F1ZGl0JyksIFNLID0gdGltZXN0YW1wTXNcbiAgICAgICAgICAgIC8vIFRoaXMgYWxsb3dzIHNvcnRpbmcgYWxsIGF1ZGl0IGxvZ3MgY2hyb25vbG9naWNhbGx5XG4gICAgICAgICAgICBpbmRleDoge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdnc2kzJyxcbiAgICAgICAgICAgICAgICBmaWx0ZXJzOiB7XG4gICAgICAgICAgICAgICAgICAgIGF1ZGl0VHlwZTogJ2F1ZGl0J1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gc3VwZXIubGlzdChtb2RpZmllZFF1ZXJ5LCBjdHgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIE92ZXJyaWRlIHRoZSBiYXNlIHNlYXJjaCBtZXRob2QgdG8gcmV0dXJuIGxhdGVzdCBhdWRpdCByZWNvcmRzIGZpcnN0XG4gICAgICogVGhpcyBlbnN1cmVzIGF1ZGl0IGxvZ3MgYXJlIGRpc3BsYXllZCB3aXRoIG1vc3QgcmVjZW50IGVudHJpZXMgYXQgdGhlIHRvcFxuICAgICAqIEFkZHMgZGVmYXVsdCBzb3J0aW5nIGJ5IHRpbWVzdGFtcCBpbiBkZXNjZW5kaW5nIG9yZGVyIHdoZW4gbm8gc29ydCBpcyBzcGVjaWZpZWRcbiAgICAgKi9cbiAgICBwdWJsaWMgYXN5bmMgc2VhcmNoKHF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+LCBjdHg/OiBFeGVjdXRpb25Db250ZXh0KSB7XG4gICAgICAgIC8vIFNldCBkZWZhdWx0IHNvcnQgdG8gJ3RpbWVzdGFtcDpkZXNjJyBmb3IgYXVkaXQgbG9ncyB0byBzaG93IGxhdGVzdCBmaXJzdFxuICAgICAgICAvLyBBbGxvdyBvdmVycmlkZSB2aWEgcXVlcnkgcGFyYW1ldGVyIGlmIG5lZWRlZFxuICAgICAgICBjb25zdCBtb2RpZmllZFF1ZXJ5OiBFbnRpdHlTZWFyY2hRdWVyeTxBdWRpdEVudGl0eVNjaGVtYVR5cGU+ID0ge1xuICAgICAgICAgICAgLi4ucXVlcnksXG4gICAgICAgICAgICAvLyBPbmx5IGFkZCBkZWZhdWx0IHNvcnQgaWYgbm8gc29ydCBpcyBzcGVjaWZpZWRcbiAgICAgICAgICAgIHNvcnQ6IHF1ZXJ5LnNvcnQgJiYgcXVlcnkuc29ydC5sZW5ndGggPiAwIFxuICAgICAgICAgICAgICAgID8gcXVlcnkuc29ydCBcbiAgICAgICAgICAgICAgICA6IFt7IGZpZWxkOiAndGltZXN0YW1wJyBhcyBjb25zdCwgZGlyOiAnZGVzYycgYXMgY29uc3QgfV1cbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gc3VwZXIuc2VhcmNoKG1vZGlmaWVkUXVlcnksIGN0eCk7XG4gICAgfVxufVxuIl19