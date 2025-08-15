"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const base_entity_1 = require("../entity/base-entity");
var User;
(function (User) {
    User.createUserSchema = () => (0, base_entity_1.createEntitySchema)({
        model: {
            version: '1',
            entity: 'user',
            entityNamePlural: 'Users',
            entityOperations: base_entity_1.DefaultEntityOperations,
            service: 'users', // electro DB service name [logical group of entities]
            search: {
                enabled: true,
                indexConfig: {
                    name: 'userIdxxxx',
                    settings: {
                        searchableAttributes: ['firstName', 'lastName'],
                    }
                }
            }
        },
        attributes: {
            userId: {
                type: 'string',
                required: true,
                readOnly: true,
                isSearchable: false,
                default: () => (0, crypto_1.randomUUID)()
            },
            tenantId: {
                type: 'string',
                required: true,
                readOnly: true,
                default: () => 'xxx-yyy-zzz',
            },
            firstName: {
                type: 'string',
                required: true,
            },
            lastName: {
                type: 'string',
            },
            email: {
                type: 'string',
                required: true,
            },
            password: {
                type: 'string',
                isFilterable: false,
                hidden: true,
                required: true,
            },
            createdAt: {
                // will be set once at the time of create
                type: "string",
                readOnly: true,
                required: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            updatedAt: {
                type: "string",
                watch: "*", // will be set every time any prop is updated
                required: true,
                readOnly: true,
                default: () => Date.now().toString(),
                set: () => Date.now().toString(),
            },
            deletedAt: {
                type: "string",
                readOnly: false
            },
        },
        indexes: {
            primary: {
                pk: {
                    field: 'pk',
                    template: "t_${tenantId}#u_${userId}",
                    composite: ['tenantId', 'userId'],
                },
                sk: {
                    field: 'sk',
                    composite: [],
                },
            },
            byEmail: {
                index: 'gsi1',
                pk: {
                    field: 'gsi1pk',
                    template: "t_${tenantId}#u_${email}",
                    composite: ['tenantId', 'email'],
                },
                sk: {
                    field: 'gsi1sk',
                    composite: [],
                },
            },
        },
    });
    User.schema = User.createUserSchema();
    User.entity = (0, base_entity_1.createElectroDBEntity)({
        schema: User.schema, entityConfigurations: {
            table: 'xxxx'
        }
    });
    const abc = {
        searchableAttributes: ['firstName', 'lastName'],
        filterableAttributes: ['tenantId'],
        sortableAttributes: ['createdAt'],
        selectableAttributes: ['userId', 'firstName', 'lastName', 'email'],
    };
    const x = {
        search: 'test',
        sort: [{ field: 'createdAt', dir: 'asc' }],
        select: ['userId', 'firstName', 'lastName', 'email'],
        distinct: 'userId',
        facets: ['tenantId'],
        filters: {
            and: [
                {
                    logicalOp: 'and',
                    tenantId: {
                        eq: 'xxx-yyy-zzz'
                    },
                    userId: {
                        eq: 'xxx-yyy-zzz'
                    }
                },
                {
                    firstName: {
                        contains: 'test'
                    }
                }
            ]
        },
        pagination: {
            page: 1,
            limit: 10
        },
        crop: {
            fields: ['firstName', 'lastName'],
            length: 10,
            marker: '...'
        },
        matchingStrategy: 'all',
        geoBoundingBoxFilter: {
            bottomRight: {
                lat: 12.345678,
                lng: 98.765432,
            },
            topLeft: {
                lat: 12.345678,
                lng: 98.765432,
            },
        },
        geoRadiusFilter: {
            center: {
                lat: 12.345678,
                lng: 98.765432,
            },
            distanceInMeters: 100,
        },
        geoSort: {
            point: {
                lat: 12.345678,
                lng: 98.765432,
            },
            direction: 'asc',
        },
        highlight: {
            fields: ['firstName', 'lastName'],
            preTag: '<b>',
            postTag: '</b>',
            showMatchesPosition: true
        },
        searchAttributes: ['firstName', 'lastName'],
    };
})(User || (User = {}));
describe('test', () => {
    it('should be defined', () => {
        expect(1).toBe(1);
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMudGVzdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zZWFyY2gvdHlwZXMudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUVBLG1DQUFvQztBQUNwQyx1REFHK0I7QUFHL0IsSUFBVSxJQUFJLENBNk1iO0FBN01ELFdBQVUsSUFBSTtJQUVDLHFCQUFnQixHQUFHLEdBQUcsRUFBRSxDQUFDLElBQUEsZ0NBQWtCLEVBQUM7UUFDdkQsS0FBSyxFQUFFO1lBQ0wsT0FBTyxFQUFFLEdBQUc7WUFDWixNQUFNLEVBQUUsTUFBTTtZQUNkLGdCQUFnQixFQUFFLE9BQU87WUFDekIsZ0JBQWdCLEVBQUUscUNBQXVCO1lBQ3pDLE9BQU8sRUFBRSxPQUFPLEVBQUUsc0RBQXNEO1lBQ3hFLE1BQU0sRUFBRTtnQkFDTixPQUFPLEVBQUUsSUFBSTtnQkFDYixXQUFXLEVBQUU7b0JBQ1gsSUFBSSxFQUFFLFlBQVk7b0JBQ2xCLFFBQVEsRUFBRTt3QkFDUixvQkFBb0IsRUFBRSxDQUFFLFdBQVcsRUFBRSxVQUFVLENBQUU7cUJBQ2xEO2lCQUNGO2FBQ0Y7U0FDRjtRQUNELFVBQVUsRUFBRTtZQUNWLE1BQU0sRUFBRTtnQkFDTixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxZQUFZLEVBQUUsS0FBSztnQkFDbkIsT0FBTyxFQUFFLEdBQUcsRUFBRSxDQUFDLElBQUEsbUJBQVUsR0FBRTthQUM1QjtZQUNELFFBQVEsRUFBRTtnQkFDUixJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxRQUFRLEVBQUUsSUFBSTtnQkFDZCxPQUFPLEVBQUUsR0FBRyxFQUFFLENBQUMsYUFBYTthQUM3QjtZQUNELFNBQVMsRUFBRTtnQkFDVCxJQUFJLEVBQUUsUUFBUTtnQkFDZCxRQUFRLEVBQUUsSUFBSTthQUNmO1lBQ0QsUUFBUSxFQUFFO2dCQUNS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SCxDQUFDLEVBN01TLElBQUksS0FBSixJQUFJLFFBNk1iO0FBR0QsUUFBUSxDQUFDLE1BQU0sRUFBRSxHQUFHLEVBQUU7SUFDcEIsRUFBRSxDQUFDLG1CQUFtQixFQUFFLEdBQUcsRUFBRTtRQUMzQixNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BCLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBWYWx1ZU9mIH0gZnJvbSAnLi8uLi91dGlscy90eXBlcyc7XG5cbmltcG9ydCB7IHJhbmRvbVVVSUQgfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHtcbiAgY3JlYXRlRWxlY3Ryb0RCRW50aXR5LCBjcmVhdGVFbnRpdHlSZWxhdGlvbiwgY3JlYXRlRW50aXR5U2NoZW1hLFxuICBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucywgRW50aXR5QXR0cmlidXRlLCBFbnRpdHlTY2hlbWFcbn0gZnJvbSAnLi4vZW50aXR5L2Jhc2UtZW50aXR5JztcbmltcG9ydCB7IEVudGl0eVNlYXJjaFF1ZXJ5LCBFeHRyYWN0RW50aXR5QXR0cmlidXRlc09mVHlwZSwgRXh0cmFjdEVudGl0eUZpbHRlcmFibGVBdHRyaWJ1dGVzLCBFeHRyYWN0RW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXMsIEV4dHJhY3RFbnRpdHlTZWxlY3RhYmxlQXR0cmlidXRlcywgRXh0cmFjdEVudGl0eVNvcnRhYmxlQXR0cmlidXRlcywgSW5mZXJJbmRleFNlYXJjaEZpbHRlckNyaXRlcmlhLCBJbmZlckVudGl0eVNlYXJjaEluZGV4Q29uZmlnIH0gZnJvbSAnLi90eXBlcyc7XG5cbm5hbWVzcGFjZSBVc2VyIHtcblxuICBleHBvcnQgY29uc3QgY3JlYXRlVXNlclNjaGVtYSA9ICgpID0+IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gICAgbW9kZWw6IHtcbiAgICAgIHZlcnNpb246ICcxJyxcbiAgICAgIGVudGl0eTogJ3VzZXInLFxuICAgICAgZW50aXR5TmFtZVBsdXJhbDogJ1VzZXJzJyxcbiAgICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgICAgc2VydmljZTogJ3VzZXJzJywgLy8gZWxlY3RybyBEQiBzZXJ2aWNlIG5hbWUgW2xvZ2ljYWwgZ3JvdXAgb2YgZW50aXRpZXNdXG4gICAgICBzZWFyY2g6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgICBuYW1lOiAndXNlcklkeHh4eCcsXG4gICAgICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbICdmaXJzdE5hbWUnLCAnbGFzdE5hbWUnIF0sXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICBhdHRyaWJ1dGVzOiB7XG4gICAgICB1c2VySWQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgaXNTZWFyY2hhYmxlOiBmYWxzZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gcmFuZG9tVVVJRCgpXG4gICAgICB9LFxuICAgICAgdGVuYW50SWQ6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICByZWFkT25seTogdHJ1ZSxcbiAgICAgICAgZGVmYXVsdDogKCkgPT4gJ3h4eC15eXktenp6JyxcbiAgICAgIH0sXG4gICAgICBmaXJzdE5hbWU6IHtcbiAgICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGxhc3ROYW1lOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgfSxcbiAgICAgIGVtYWlsOiB7XG4gICAgICAgIHR5cGU6ICdzdHJpbmcnLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBwYXNzd29yZDoge1xuICAgICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICAgICAgaXNGaWx0ZXJhYmxlOiBmYWxzZSxcbiAgICAgICAgaGlkZGVuOiB0cnVlLFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBjcmVhdGVkQXQ6IHtcbiAgICAgICAgLy8gd2lsbCBiZSBzZXQgb25jZSBhdCB0aGUgdGltZSBvZiBjcmVhdGVcbiAgICAgICAgdHlwZTogXCJzdHJpbmdcIixcbiAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgIHJlcXVpcmVkOiB0cnVlLFxuICAgICAgICBkZWZhdWx0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICAgIHNldDogKCkgPT4gRGF0ZS5ub3coKS50b1N0cmluZygpLFxuICAgICAgfSxcbiAgICAgIHVwZGF0ZWRBdDoge1xuICAgICAgICB0eXBlOiBcInN0cmluZ1wiLFxuICAgICAgICB3YXRjaDogXCIqXCIsIC8vIHdpbGwgYmUgc2V0IGV2ZXJ5IHRpbWUgYW55IHByb3AgaXMgdXBkYXRlZFxuICAgICAgICByZXF1aXJlZDogdHJ1ZSxcbiAgICAgICAgcmVhZE9ubHk6IHRydWUsXG4gICAgICAgIGRlZmF1bHQ6ICgpID0+IERhdGUubm93KCkudG9TdHJpbmcoKSxcbiAgICAgICAgc2V0OiAoKSA9PiBEYXRlLm5vdygpLnRvU3RyaW5nKCksXG4gICAgICB9LFxuICAgICAgZGVsZXRlZEF0OiB7XG4gICAgICAgIHR5cGU6IFwic3RyaW5nXCIsXG4gICAgICAgIHJlYWRPbmx5OiBmYWxzZVxuICAgICAgfSxcbiAgICB9LFxuICAgIGluZGV4ZXM6IHtcbiAgICAgIHByaW1hcnk6IHtcbiAgICAgICAgcGs6IHtcbiAgICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgICB0ZW1wbGF0ZTogXCJ0XyR7dGVuYW50SWR9I3VfJHt1c2VySWR9XCIsXG4gICAgICAgICAgY29tcG9zaXRlOiBbICd0ZW5hbnRJZCcsICd1c2VySWQnIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHNrOiB7XG4gICAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgICAgY29tcG9zaXRlOiBbXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBieUVtYWlsOiB7XG4gICAgICAgIGluZGV4OiAnZ3NpMScsXG4gICAgICAgIHBrOiB7XG4gICAgICAgICAgZmllbGQ6ICdnc2kxcGsnLFxuICAgICAgICAgIHRlbXBsYXRlOiBcInRfJHt0ZW5hbnRJZH0jdV8ke2VtYWlsfVwiLFxuICAgICAgICAgIGNvbXBvc2l0ZTogWyAndGVuYW50SWQnLCAnZW1haWwnIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHNrOiB7XG4gICAgICAgICAgZmllbGQ6ICdnc2kxc2snLFxuICAgICAgICAgIGNvbXBvc2l0ZTogW10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0gYXMgY29uc3QpO1xuXG4gIGV4cG9ydCB0eXBlIFRVc2VyU2NoZW1hID0gUmV0dXJuVHlwZTx0eXBlb2YgY3JlYXRlVXNlclNjaGVtYT5cblxuXG4gIGV4cG9ydCBjb25zdCBzY2hlbWEgPSBjcmVhdGVVc2VyU2NoZW1hKCk7XG4gIGV4cG9ydCBjb25zdCBlbnRpdHkgPSBjcmVhdGVFbGVjdHJvREJFbnRpdHkoe1xuICAgIHNjaGVtYTogc2NoZW1hLCBlbnRpdHlDb25maWd1cmF0aW9uczoge1xuICAgICAgdGFibGU6ICd4eHh4J1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gQFNlcnZpY2Uoe2ZvckVudGl0eTogc2NoZW1hLm1vZGVsLmVudGl0eX0pXG4gIC8vIGNsYXNzIFVzZXJTZXJ2aWNlIGV4dGVuZHMgQmFzZUVudGl0eVNlcnZpY2U8VXNlci5UVXNlclNjaGVtYT4ge1xuICAvLyAgIGNvbnN0cnVjdG9yKCl7XG4gIC8vICAgICBzdXBlcihVc2VyLnNjaGVtYSwgbnVsbCBhcyBhbnksIERJQ29udGFpbmVyLlJPT1QpO1xuICAvLyAgIH1cbiAgLy8gfVxuXG4gIHR5cGUgeHggPSBJbmZlckVudGl0eVNlYXJjaEluZGV4Q29uZmlnPFRVc2VyU2NoZW1hPlxuXG4gIGNvbnN0IGFiYzogeHggPSB7XG4gICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFsgJ2ZpcnN0TmFtZScsICdsYXN0TmFtZScgXSxcbiAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogWyAndGVuYW50SWQnIF0sXG4gICAgc29ydGFibGVBdHRyaWJ1dGVzOiBbICdjcmVhdGVkQXQnIF0sXG4gICAgc2VsZWN0YWJsZUF0dHJpYnV0ZXM6IFsgJ3VzZXJJZCcsICdmaXJzdE5hbWUnLCAnbGFzdE5hbWUnLCAnZW1haWwnIF0sXG4gIH1cblxuICB0eXBlIHl5ID0geHhbICdzb3J0YWJsZUF0dHJpYnV0ZXMnIF1bIG51bWJlciBdXG5cbiAgdHlwZSBldHNxID0gRW50aXR5U2VhcmNoUXVlcnk8VFVzZXJTY2hlbWE+XG5cbiAgdHlwZSBzQ25mID0gSW5mZXJFbnRpdHlTZWFyY2hJbmRleENvbmZpZzxUVXNlclNjaGVtYT47XG5cbiAgdHlwZSBjZiA9IEV4dHJhY3Q8VmFsdWVPZjxzQ25mWyAnZmlsdGVyYWJsZUF0dHJpYnV0ZXMnIF0+LCBzdHJpbmc+XG5cbiAgdHlwZSBzU2FyY2ggPSBFeHRyYWN0RW50aXR5U2VhcmNoYWJsZUF0dHJpYnV0ZXM8VFVzZXJTY2hlbWE+XG4gIHR5cGUgc0ZpbHRlciA9IEV4dHJhY3RFbnRpdHlGaWx0ZXJhYmxlQXR0cmlidXRlczxUVXNlclNjaGVtYT5cbiAgdHlwZSBzRmlsdGVyMiA9IEV4dHJhY3RFbnRpdHlTb3J0YWJsZUF0dHJpYnV0ZXM8VFVzZXJTY2hlbWE+XG4gIHR5cGUgc0ZpbHRlcjMgPSBFeHRyYWN0RW50aXR5U2VsZWN0YWJsZUF0dHJpYnV0ZXM8VFVzZXJTY2hlbWE+XG5cblxuICBjb25zdCB4OiBFbnRpdHlTZWFyY2hRdWVyeTxUVXNlclNjaGVtYT4gPSB7XG4gICAgc2VhcmNoOiAndGVzdCcsXG4gICAgc29ydDogWyB7IGZpZWxkOiAnY3JlYXRlZEF0JywgZGlyOiAnYXNjJyB9IF0sXG4gICAgc2VsZWN0OiBbICd1c2VySWQnLCAnZmlyc3ROYW1lJywgJ2xhc3ROYW1lJywgJ2VtYWlsJyBdLFxuICAgIGRpc3RpbmN0OiAndXNlcklkJyxcbiAgICBmYWNldHM6IFsgJ3RlbmFudElkJyBdLFxuICAgIGZpbHRlcnM6IHtcbiAgICAgIGFuZDogW1xuICAgICAgICB7XG4gICAgICAgICAgbG9naWNhbE9wOiAnYW5kJyxcbiAgICAgICAgICB0ZW5hbnRJZDoge1xuICAgICAgICAgICAgZXE6ICd4eHgteXl5LXp6eidcbiAgICAgICAgICB9LFxuICAgICAgICAgIHVzZXJJZDoge1xuICAgICAgICAgICAgZXE6ICd4eHgteXl5LXp6eidcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBmaXJzdE5hbWU6IHtcbiAgICAgICAgICAgIGNvbnRhaW5zOiAndGVzdCdcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIF1cbiAgICB9LFxuICAgIHBhZ2luYXRpb246IHtcbiAgICAgIHBhZ2U6IDEsXG4gICAgICBsaW1pdDogMTBcbiAgICB9LFxuICAgIGNyb3A6IHtcbiAgICAgIGZpZWxkczogWyAnZmlyc3ROYW1lJywgJ2xhc3ROYW1lJyBdLFxuICAgICAgbGVuZ3RoOiAxMCxcbiAgICAgIG1hcmtlcjogJy4uLidcbiAgICB9LFxuICAgIG1hdGNoaW5nU3RyYXRlZ3k6ICdhbGwnLFxuICAgIGdlb0JvdW5kaW5nQm94RmlsdGVyOiB7XG4gICAgICBib3R0b21SaWdodDoge1xuICAgICAgICBsYXQ6IDEyLjM0NTY3OCxcbiAgICAgICAgbG5nOiA5OC43NjU0MzIsXG4gICAgICB9LFxuICAgICAgdG9wTGVmdDoge1xuICAgICAgICBsYXQ6IDEyLjM0NTY3OCxcbiAgICAgICAgbG5nOiA5OC43NjU0MzIsXG4gICAgICB9LFxuICAgIH0sXG4gICAgZ2VvUmFkaXVzRmlsdGVyOiB7XG4gICAgICBjZW50ZXI6IHtcbiAgICAgICAgbGF0OiAxMi4zNDU2NzgsXG4gICAgICAgIGxuZzogOTguNzY1NDMyLFxuICAgICAgfSxcbiAgICAgIGRpc3RhbmNlSW5NZXRlcnM6IDEwMCxcbiAgICB9LFxuICAgIGdlb1NvcnQ6IHtcbiAgICAgIHBvaW50OiB7XG4gICAgICAgIGxhdDogMTIuMzQ1Njc4LFxuICAgICAgICBsbmc6IDk4Ljc2NTQzMixcbiAgICAgIH0sXG4gICAgICBkaXJlY3Rpb246ICdhc2MnLFxuICAgIH0sXG4gICAgaGlnaGxpZ2h0OiB7XG4gICAgICBmaWVsZHM6IFsgJ2ZpcnN0TmFtZScsICdsYXN0TmFtZScgXSxcbiAgICAgIHByZVRhZzogJzxiPicsXG4gICAgICBwb3N0VGFnOiAnPC9iPicsXG4gICAgICBzaG93TWF0Y2hlc1Bvc2l0aW9uOiB0cnVlXG4gICAgfSxcbiAgICBzZWFyY2hBdHRyaWJ1dGVzOiBbICdmaXJzdE5hbWUnLCAnbGFzdE5hbWUnIF0sXG4gIH1cblxufVxuXG5cbmRlc2NyaWJlKCd0ZXN0JywgKCkgPT4ge1xuICBpdCgnc2hvdWxkIGJlIGRlZmluZWQnLCAoKSA9PiB7XG4gICAgZXhwZWN0KDEpLnRvQmUoMSk7XG4gIH0pO1xufSk7XG5cbiJdfQ==