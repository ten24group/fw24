"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const entity_search_service_1 = require("./entity-search-service");
const entity_1 = require("../../entity");
// Create a test schema
const testSchema = (0, entity_1.createEntitySchema)({
    model: {
        entity: 'test',
        service: 'test',
        version: '1',
        entityNamePlural: 'Tests',
        entityOperations: entity_1.DefaultEntityOperations,
        search: {
            enabled: true,
            indexConfig: {
                provider: 'meili',
                settings: {
                    searchableAttributes: ['title', 'description', 'author.name', 'author.email']
                }
            },
            documentTransformer: (entity) => ({
                ...entity,
                transformed: true
            })
        }
    },
    attributes: {
        id: {
            type: 'number',
            required: true
        },
        title: {
            type: 'string',
        },
        author: {
            type: 'map',
            properties: {
                name: { type: 'string' },
                email: { type: 'string' }
            }
        }
    },
    indexes: {
        primary: {
            pk: {
                field: 'pk',
                composite: ['id']
            },
            sk: {
                field: 'sk',
                composite: ['id']
            }
        }
    },
});
describe('EntitySearchService', () => {
    let service;
    let mockEntityService;
    let mockSearchEngine;
    let searchConfig;
    let mockContext;
    beforeEach(() => {
        mockSearchEngine = {
            search: jest.fn(),
            index: jest.fn(),
            delete: jest.fn(),
            initIndex: jest.fn(),
            config: jest.fn(),
            validateConfig: jest.fn(),
        };
        searchConfig = {
            provider: 'meili',
            indexName: 'test-index',
            settings: {
                searchableAttributes: ['title', 'description'],
                filterableAttributes: ['category', 'status']
            }
        };
        mockContext = {
            event: {},
            lambdaContext: {},
            request: {},
            response: {}
        };
        // Setup mocks
        mockEntityService = {
            getEntitySchema: jest.fn().mockReturnValue(testSchema),
            hydrateRecords: jest.fn(),
            getEntitySearchConfig: jest.fn().mockReturnValue(testSchema.model.search)
        };
        service = new entity_search_service_1.EntitySearchService(mockEntityService, mockSearchEngine);
    });
    describe('transformDocumentForIndexing', () => {
        it('should use schema-defined transformer if available', async () => {
            const entity = { id: 1, title: 'Test Document' };
            const schema = {
                ...testSchema,
            };
            mockEntityService.getEntitySchema.mockReturnValue(schema);
            const result = await service.transformDocumentForIndexing(entity);
            expect(result).toEqual({
                ...entity,
                transformed: true
            });
        });
        it('should handle searchable relations', async () => {
            const entity = {
                id: 1,
                title: 'Test Document',
                author: {
                    name: 'John Doe',
                    email: 'john@example.com'
                }
            };
            const schema = { ...testSchema };
            mockEntityService.getEntitySchema.mockReturnValue(schema);
            const result = await service.transformDocumentForIndexing(entity);
            expect(result).toEqual({
                ...entity,
                author: {
                    name: 'John Doe',
                    email: 'john@example.com'
                },
                transformed: true
            });
        });
        it('should handle missing relations gracefully', async () => {
            const entity = {
                id: 1,
                title: 'Test Document'
            };
            const schema = { ...testSchema };
            mockEntityService.getEntitySchema.mockReturnValue(schema);
            const result = await service.transformDocumentForIndexing(entity);
            expect(result).toEqual({
                ...entity,
                transformed: true
            });
        });
        it('should use default transformation when no schema transformer is defined', async () => {
            const entity = { id: 1, title: 'Test Document' };
            const schema = { ...testSchema };
            // @ts-ignore-next-line
            schema.model.search.documentTransformer = undefined;
            mockEntityService.getEntitySchema.mockReturnValue(schema);
            const result = await service.transformDocumentForIndexing(entity);
            expect(result).toEqual(entity);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNlYXJjaC1zZXJ2aWNlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3NlcnZpY2VzL2VudGl0eS1zZWFyY2gtc2VydmljZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0EsbUVBQThEO0FBQzlELHlDQUE0RztBQUs1Ryx1QkFBdUI7QUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBQSwyQkFBa0IsRUFBQztJQUNwQyxLQUFLLEVBQUU7UUFDTCxNQUFNLEVBQUUsTUFBTTtRQUNkLE9BQU8sRUFBRSxNQUFNO1FBQ2YsT0FBTyxFQUFFLEdBQUc7UUFDWixnQkFBZ0IsRUFBRSxPQUFPO1FBQ3pCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsSUFBSTtZQUNiLFdBQVcsRUFBRTtnQkFDWCxRQUFRLEVBQUUsT0FBTztnQkFDakIsUUFBUSxFQUFFO29CQUNSLG9CQUFvQixFQUFFLENBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUsY0FBYyxDQUFFO2lCQUNoRjthQUNGO1lBQ0QsbUJBQW1CLEVBQUUsQ0FBQyxNQUFXLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ3JDLEdBQUcsTUFBTTtnQkFDVCxXQUFXLEVBQUUsSUFBSTthQUNsQixDQUFDO1NBQ0g7S0FDRjtJQUNELFVBQVUsRUFBRTtRQUNWLEVBQUUsRUFBRTtZQUNGLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCxNQUFNLEVBQUU7WUFDTixJQUFJLEVBQUUsS0FBSztZQUNYLFVBQVUsRUFBRTtnQkFDVixJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2dCQUN4QixLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2FBQzFCO1NBQ0Y7S0FD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QUFVLEVBQUUsQ0FBQztZQUVqQyx1QkFBdUI7WUFDdkIsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsbUJBQW1CLEdBQUcsU0FBUyxDQUFDO1lBRXBELGlCQUFpQixDQUFDLGVBQWUsQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFMUQsTUFBTSxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLENBQUM7WUFFbEUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNqQyxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZWFyY2hJbmRleENvbmZpZyB9IGZyb20gXCIuLi90eXBlc1wiO1xuaW1wb3J0IHsgRW50aXR5U2VhcmNoU2VydmljZSB9IGZyb20gXCIuL2VudGl0eS1zZWFyY2gtc2VydmljZVwiO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIGNyZWF0ZUVudGl0eVNjaGVtYSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsIEVudGl0eVNjaGVtYSB9IGZyb20gJy4uLy4uL2VudGl0eSc7XG5pbXBvcnQgeyBBUElHYXRld2F5RXZlbnQsIENvbnRleHQgfSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IFJlcXVlc3QsIFJlc3BvbnNlIH0gZnJvbSAnLi4vLi4vaW50ZXJmYWNlcyc7XG5pbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSBcIi4uL2VuZ2luZXNcIjtcblxuLy8gQ3JlYXRlIGEgdGVzdCBzY2hlbWFcbmNvbnN0IHRlc3RTY2hlbWEgPSBjcmVhdGVFbnRpdHlTY2hlbWEoe1xuICBtb2RlbDoge1xuICAgIGVudGl0eTogJ3Rlc3QnLFxuICAgIHNlcnZpY2U6ICd0ZXN0JyxcbiAgICB2ZXJzaW9uOiAnMScsXG4gICAgZW50aXR5TmFtZVBsdXJhbDogJ1Rlc3RzJyxcbiAgICBlbnRpdHlPcGVyYXRpb25zOiBEZWZhdWx0RW50aXR5T3BlcmF0aW9ucyxcbiAgICBzZWFyY2g6IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBpbmRleENvbmZpZzoge1xuICAgICAgICBwcm92aWRlcjogJ21laWxpJyxcbiAgICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogWyAndGl0bGUnLCAnZGVzY3JpcHRpb24nLCAnYXV0aG9yLm5hbWUnLCAnYXV0aG9yLmVtYWlsJyBdXG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBkb2N1bWVudFRyYW5zZm9ybWVyOiAoZW50aXR5OiBhbnkpID0+ICh7XG4gICAgICAgIC4uLmVudGl0eSxcbiAgICAgICAgdHJhbnNmb3JtZWQ6IHRydWVcbiAgICAgIH0pXG4gICAgfVxuICB9LFxuICBhdHRyaWJ1dGVzOiB7XG4gICAgaWQ6IHtcbiAgICAgIHR5cGU6ICdudW1iZXInLFxuICAgICAgcmVxdWlyZWQ6IHRydWVcbiAgICB9LFxuICAgIHRpdGxlOiB7XG4gICAgICB0eXBlOiAnc3RyaW5nJyxcbiAgICB9LFxuICAgIGF1dGhvcjoge1xuICAgICAgdHlwZTogJ21hcCcsXG4gICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgIG5hbWU6IHsgdHlwZTogJ3N0cmluZycgfSxcbiAgICAgICAgZW1haWw6IHsgdHlwZTogJ3N0cmluZycgfVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgaW5kZXhlczoge1xuICAgIHByaW1hcnk6IHtcbiAgICAgIHBrOiB7XG4gICAgICAgIGZpZWxkOiAncGsnLFxuICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdXG4gICAgICB9LFxuICAgICAgc2s6IHtcbiAgICAgICAgZmllbGQ6ICdzaycsXG4gICAgICAgIGNvbXBvc2l0ZTogWyAnaWQnIF1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG59IGFzIGNvbnN0KTtcblxudHlwZSBUZXN0U2NoZW1hID0gdHlwZW9mIHRlc3RTY2hlbWE7XG5cbmRlc2NyaWJlKCdFbnRpdHlTZWFyY2hTZXJ2aWNlJywgKCkgPT4ge1xuICBsZXQgc2VydmljZTogRW50aXR5U2VhcmNoU2VydmljZTxUZXN0U2NoZW1hPjtcbiAgbGV0IG1vY2tFbnRpdHlTZXJ2aWNlOiBqZXN0Lk1vY2tlZDxCYXNlRW50aXR5U2VydmljZTxUZXN0U2NoZW1hPj47XG4gIGxldCBtb2NrU2VhcmNoRW5naW5lOiBqZXN0Lk1vY2tlZDxCYXNlU2VhcmNoRW5naW5lPjtcbiAgbGV0IHNlYXJjaENvbmZpZzogU2VhcmNoSW5kZXhDb25maWc7XG4gIGxldCBtb2NrQ29udGV4dDogYW55O1xuXG4gIGJlZm9yZUVhY2goKCkgPT4ge1xuXG4gICAgbW9ja1NlYXJjaEVuZ2luZSA9IHtcbiAgICAgIHNlYXJjaDogamVzdC5mbigpLFxuICAgICAgaW5kZXg6IGplc3QuZm4oKSxcbiAgICAgIGRlbGV0ZTogamVzdC5mbigpLFxuICAgICAgaW5pdEluZGV4OiBqZXN0LmZuKCksXG4gICAgICBjb25maWc6IGplc3QuZm4oKSxcbiAgICAgIHZhbGlkYXRlQ29uZmlnOiBqZXN0LmZuKCksXG4gICAgfSBhcyBhbnk7XG5cbiAgICBzZWFyY2hDb25maWcgPSB7XG4gICAgICBwcm92aWRlcjogJ21laWxpJyxcbiAgICAgIGluZGV4TmFtZTogJ3Rlc3QtaW5kZXgnLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFsgJ3RpdGxlJywgJ2Rlc2NyaXB0aW9uJyBdLFxuICAgICAgICBmaWx0ZXJhYmxlQXR0cmlidXRlczogWyAnY2F0ZWdvcnknLCAnc3RhdHVzJyBdXG4gICAgICB9XG4gICAgfTtcblxuICAgIG1vY2tDb250ZXh0ID0ge1xuICAgICAgZXZlbnQ6IHt9IGFzIEFQSUdhdGV3YXlFdmVudCxcbiAgICAgIGxhbWJkYUNvbnRleHQ6IHt9IGFzIENvbnRleHQsXG4gICAgICByZXF1ZXN0OiB7fSBhcyBSZXF1ZXN0LFxuICAgICAgcmVzcG9uc2U6IHt9IGFzIFJlc3BvbnNlXG4gICAgfTtcblxuICAgIC8vIFNldHVwIG1vY2tzXG4gICAgbW9ja0VudGl0eVNlcnZpY2UgPSB7XG4gICAgICBnZXRFbnRpdHlTY2hlbWE6IGplc3QuZm4oKS5tb2NrUmV0dXJuVmFsdWUodGVzdFNjaGVtYSksXG4gICAgICBoeWRyYXRlUmVjb3JkczogamVzdC5mbigpLFxuICAgICAgZ2V0RW50aXR5U2VhcmNoQ29uZmlnOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHRlc3RTY2hlbWEubW9kZWwuc2VhcmNoKVxuICAgIH0gYXMgYW55O1xuXG4gICAgc2VydmljZSA9IG5ldyBFbnRpdHlTZWFyY2hTZXJ2aWNlKG1vY2tFbnRpdHlTZXJ2aWNlLCBtb2NrU2VhcmNoRW5naW5lKTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3RyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB1c2Ugc2NoZW1hLWRlZmluZWQgdHJhbnNmb3JtZXIgaWYgYXZhaWxhYmxlJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZW50aXR5ID0geyBpZDogMSwgdGl0bGU6ICdUZXN0IERvY3VtZW50JyB9O1xuICAgICAgY29uc3Qgc2NoZW1hID0ge1xuICAgICAgICAuLi50ZXN0U2NoZW1hLFxuICAgICAgfTtcblxuICAgICAgbW9ja0VudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hLm1vY2tSZXR1cm5WYWx1ZShzY2hlbWEpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIC4uLmVudGl0eSxcbiAgICAgICAgdHJhbnNmb3JtZWQ6IHRydWVcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgc2VhcmNoYWJsZSByZWxhdGlvbnMnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHkgPSB7XG4gICAgICAgIGlkOiAxLFxuICAgICAgICB0aXRsZTogJ1Rlc3QgRG9jdW1lbnQnLFxuICAgICAgICBhdXRob3I6IHtcbiAgICAgICAgICBuYW1lOiAnSm9obiBEb2UnLFxuICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbSdcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3Qgc2NoZW1hID0geyAuLi50ZXN0U2NoZW1hIH07XG4gICAgICBtb2NrRW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEubW9ja1JldHVyblZhbHVlKHNjaGVtYSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHkpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKHtcbiAgICAgICAgLi4uZW50aXR5LFxuICAgICAgICBhdXRob3I6IHtcbiAgICAgICAgICBuYW1lOiAnSm9obiBEb2UnLFxuICAgICAgICAgIGVtYWlsOiAnam9obkBleGFtcGxlLmNvbSdcbiAgICAgICAgfSxcbiAgICAgICAgdHJhbnNmb3JtZWQ6IHRydWVcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBoYW5kbGUgbWlzc2luZyByZWxhdGlvbnMgZ3JhY2VmdWxseScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eSA9IHtcbiAgICAgICAgaWQ6IDEsXG4gICAgICAgIHRpdGxlOiAnVGVzdCBEb2N1bWVudCdcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVtYSA9IHsgLi4udGVzdFNjaGVtYSB9O1xuICAgICAgbW9ja0VudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hLm1vY2tSZXR1cm5WYWx1ZShzY2hlbWEpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIC4uLmVudGl0eSxcbiAgICAgICAgdHJhbnNmb3JtZWQ6IHRydWVcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCB1c2UgZGVmYXVsdCB0cmFuc2Zvcm1hdGlvbiB3aGVuIG5vIHNjaGVtYSB0cmFuc2Zvcm1lciBpcyBkZWZpbmVkJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZW50aXR5ID0geyBpZDogMSwgdGl0bGU6ICdUZXN0IERvY3VtZW50JyB9O1xuICAgICAgY29uc3Qgc2NoZW1hID0geyAuLi50ZXN0U2NoZW1hIH07XG5cbiAgICAgIC8vIEB0cy1pZ25vcmUtbmV4dC1saW5lXG4gICAgICBzY2hlbWEubW9kZWwuc2VhcmNoLmRvY3VtZW50VHJhbnNmb3JtZXIgPSB1bmRlZmluZWQ7XG5cbiAgICAgIG1vY2tFbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYS5tb2NrUmV0dXJuVmFsdWUoc2NoZW1hKTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoZW50aXR5KTtcbiAgICB9KTtcbiAgfSk7XG59KTtcbiJdfQ==