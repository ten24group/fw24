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
            getEntitySearchConfig: jest.fn().mockReturnValue(testSchema.model.search),
            getEntityName: jest.fn().mockReturnValue('TestEntity')
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW50aXR5LXNlYXJjaC1zZXJ2aWNlLnRlc3QuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3NlcnZpY2VzL2VudGl0eS1zZWFyY2gtc2VydmljZS50ZXN0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQ0EsbUVBQThEO0FBQzlELHlDQUE0RztBQUs1Ryx1QkFBdUI7QUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBQSwyQkFBa0IsRUFBQztJQUNwQyxLQUFLLEVBQUU7UUFDTCxNQUFNLEVBQUUsTUFBTTtRQUNkLE9BQU8sRUFBRSxNQUFNO1FBQ2YsT0FBTyxFQUFFLEdBQUc7UUFDWixnQkFBZ0IsRUFBRSxPQUFPO1FBQ3pCLGdCQUFnQixFQUFFLGdDQUF1QjtRQUN6QyxNQUFNLEVBQUU7WUFDTixPQUFPLEVBQUUsSUFBSTtZQUNiLFdBQVcsRUFBRTtnQkFDWCxRQUFRLEVBQUUsT0FBTztnQkFDakIsUUFBUSxFQUFFO29CQUNSLG9CQUFvQixFQUFFLENBQUUsT0FBTyxFQUFFLGFBQWEsRUFBRSxhQUFhLEVBQUUsY0FBYyxDQUFFO2lCQUNoRjthQUNGO1lBQ0QsbUJBQW1CLEVBQUUsQ0FBQyxNQUFXLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ3JDLEdBQUcsTUFBTTtnQkFDVCxXQUFXLEVBQUUsSUFBSTthQUNsQixDQUFDO1NBQ0g7S0FDRjtJQUNELFVBQVUsRUFBRTtRQUNWLEVBQUUsRUFBRTtZQUNGLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCxNQUFNLEVBQUU7WUFDTixJQUFJLEVBQUUsS0FBSztZQUNYLFVBQVUsRUFBRTtnQkFDVixJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2dCQUN4QixLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2FBQzFCO1NBQ0Y7S0FD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QUFFLEtBQUssRUFBRSxlQUFlLEVBQUUsQ0FBQztZQUNqRCxNQUFNLE1BQU0sR0FBRyxFQUFFLEdBQUcsVUFBVSxFQUFFLENBQUM7WUFFakMsdUJBQXVCO1lBQ3ZCLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLG1CQUFtQixHQUFHLFNBQVMsQ0FBQztZQUVwRCxpQkFBaUIsQ0FBQyxlQUFlLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRTFELE1BQU0sTUFBTSxHQUFHLE1BQU0sT0FBTyxDQUFDLDRCQUE0QixDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBRWxFLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDakMsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDLENBQUMsQ0FBQztBQUNMLENBQUMsQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VhcmNoSW5kZXhDb25maWcgfSBmcm9tIFwiLi4vdHlwZXNcIjtcbmltcG9ydCB7IEVudGl0eVNlYXJjaFNlcnZpY2UgfSBmcm9tIFwiLi9lbnRpdHktc2VhcmNoLXNlcnZpY2VcIjtcbmltcG9ydCB7IEJhc2VFbnRpdHlTZXJ2aWNlLCBjcmVhdGVFbnRpdHlTY2hlbWEsIERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLCBFbnRpdHlTY2hlbWEgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgQVBJR2F0ZXdheUV2ZW50LCBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBSZXF1ZXN0LCBSZXNwb25zZSB9IGZyb20gJy4uLy4uL2ludGVyZmFjZXMnO1xuaW1wb3J0IHsgQmFzZVNlYXJjaEVuZ2luZSB9IGZyb20gXCIuLi9lbmdpbmVzXCI7XG5cbi8vIENyZWF0ZSBhIHRlc3Qgc2NoZW1hXG5jb25zdCB0ZXN0U2NoZW1hID0gY3JlYXRlRW50aXR5U2NoZW1hKHtcbiAgbW9kZWw6IHtcbiAgICBlbnRpdHk6ICd0ZXN0JyxcbiAgICBzZXJ2aWNlOiAndGVzdCcsXG4gICAgdmVyc2lvbjogJzEnLFxuICAgIGVudGl0eU5hbWVQbHVyYWw6ICdUZXN0cycsXG4gICAgZW50aXR5T3BlcmF0aW9uczogRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMsXG4gICAgc2VhcmNoOiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgaW5kZXhDb25maWc6IHtcbiAgICAgICAgcHJvdmlkZXI6ICdtZWlsaScsXG4gICAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFsgJ3RpdGxlJywgJ2Rlc2NyaXB0aW9uJywgJ2F1dGhvci5uYW1lJywgJ2F1dGhvci5lbWFpbCcgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgZG9jdW1lbnRUcmFuc2Zvcm1lcjogKGVudGl0eTogYW55KSA9PiAoe1xuICAgICAgICAuLi5lbnRpdHksXG4gICAgICAgIHRyYW5zZm9ybWVkOiB0cnVlXG4gICAgICB9KVxuICAgIH1cbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIGlkOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICB0aXRsZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgfSxcbiAgICBhdXRob3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIGVtYWlsOiB7IHR5cGU6ICdzdHJpbmcnIH1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazoge1xuICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXVxuICAgICAgfSxcbiAgICAgIHNrOiB7XG4gICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdXG4gICAgICB9XG4gICAgfVxuICB9LFxufSBhcyBjb25zdCk7XG5cbnR5cGUgVGVzdFNjaGVtYSA9IHR5cGVvZiB0ZXN0U2NoZW1hO1xuXG5kZXNjcmliZSgnRW50aXR5U2VhcmNoU2VydmljZScsICgpID0+IHtcbiAgbGV0IHNlcnZpY2U6IEVudGl0eVNlYXJjaFNlcnZpY2U8VGVzdFNjaGVtYT47XG4gIGxldCBtb2NrRW50aXR5U2VydmljZTogamVzdC5Nb2NrZWQ8QmFzZUVudGl0eVNlcnZpY2U8VGVzdFNjaGVtYT4+O1xuICBsZXQgbW9ja1NlYXJjaEVuZ2luZTogamVzdC5Nb2NrZWQ8QmFzZVNlYXJjaEVuZ2luZT47XG4gIGxldCBzZWFyY2hDb25maWc6IFNlYXJjaEluZGV4Q29uZmlnO1xuICBsZXQgbW9ja0NvbnRleHQ6IGFueTtcblxuICBiZWZvcmVFYWNoKCgpID0+IHtcblxuICAgIG1vY2tTZWFyY2hFbmdpbmUgPSB7XG4gICAgICBzZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgIGluZGV4OiBqZXN0LmZuKCksXG4gICAgICBkZWxldGU6IGplc3QuZm4oKSxcbiAgICAgIGluaXRJbmRleDogamVzdC5mbigpLFxuICAgICAgY29uZmlnOiBqZXN0LmZuKCksXG4gICAgICB2YWxpZGF0ZUNvbmZpZzogamVzdC5mbigpLFxuICAgIH0gYXMgYW55O1xuXG4gICAgc2VhcmNoQ29uZmlnID0ge1xuICAgICAgcHJvdmlkZXI6ICdtZWlsaScsXG4gICAgICBpbmRleE5hbWU6ICd0ZXN0LWluZGV4JyxcbiAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbICd0aXRsZScsICdkZXNjcmlwdGlvbicgXSxcbiAgICAgICAgZmlsdGVyYWJsZUF0dHJpYnV0ZXM6IFsgJ2NhdGVnb3J5JywgJ3N0YXR1cycgXVxuICAgICAgfVxuICAgIH07XG5cbiAgICBtb2NrQ29udGV4dCA9IHtcbiAgICAgIGV2ZW50OiB7fSBhcyBBUElHYXRld2F5RXZlbnQsXG4gICAgICBsYW1iZGFDb250ZXh0OiB7fSBhcyBDb250ZXh0LFxuICAgICAgcmVxdWVzdDoge30gYXMgUmVxdWVzdCxcbiAgICAgIHJlc3BvbnNlOiB7fSBhcyBSZXNwb25zZVxuICAgIH07XG5cbiAgICAvLyBTZXR1cCBtb2Nrc1xuICAgIG1vY2tFbnRpdHlTZXJ2aWNlID0ge1xuICAgICAgZ2V0RW50aXR5U2NoZW1hOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHRlc3RTY2hlbWEpLFxuICAgICAgaHlkcmF0ZVJlY29yZHM6IGplc3QuZm4oKSxcbiAgICAgIGdldEVudGl0eVNlYXJjaENvbmZpZzogamVzdC5mbigpLm1vY2tSZXR1cm5WYWx1ZSh0ZXN0U2NoZW1hLm1vZGVsLnNlYXJjaCksXG4gICAgICBnZXRFbnRpdHlOYW1lOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKCdUZXN0RW50aXR5JylcbiAgICB9IGFzIGFueTtcblxuICAgIHNlcnZpY2UgPSBuZXcgRW50aXR5U2VhcmNoU2VydmljZShtb2NrRW50aXR5U2VydmljZSwgbW9ja1NlYXJjaEVuZ2luZSk7XG4gIH0pO1xuXG4gIGRlc2NyaWJlKCd0cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nJywgKCkgPT4ge1xuICAgIGl0KCdzaG91bGQgdXNlIHNjaGVtYS1kZWZpbmVkIHRyYW5zZm9ybWVyIGlmIGF2YWlsYWJsZScsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eSA9IHsgaWQ6IDEsIHRpdGxlOiAnVGVzdCBEb2N1bWVudCcgfTtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHtcbiAgICAgICAgLi4udGVzdFNjaGVtYSxcbiAgICAgIH07XG5cbiAgICAgIG1vY2tFbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYS5tb2NrUmV0dXJuVmFsdWUoc2NoZW1hKTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAuLi5lbnRpdHksXG4gICAgICAgIHRyYW5zZm9ybWVkOiB0cnVlXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIHNlYXJjaGFibGUgcmVsYXRpb25zJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgZW50aXR5ID0ge1xuICAgICAgICBpZDogMSxcbiAgICAgICAgdGl0bGU6ICdUZXN0IERvY3VtZW50JyxcbiAgICAgICAgYXV0aG9yOiB7XG4gICAgICAgICAgbmFtZTogJ0pvaG4gRG9lJyxcbiAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHNjaGVtYSA9IHsgLi4udGVzdFNjaGVtYSB9O1xuICAgICAgbW9ja0VudGl0eVNlcnZpY2UuZ2V0RW50aXR5U2NoZW1hLm1vY2tSZXR1cm5WYWx1ZShzY2hlbWEpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5KTtcblxuICAgICAgZXhwZWN0KHJlc3VsdCkudG9FcXVhbCh7XG4gICAgICAgIC4uLmVudGl0eSxcbiAgICAgICAgYXV0aG9yOiB7XG4gICAgICAgICAgbmFtZTogJ0pvaG4gRG9lJyxcbiAgICAgICAgICBlbWFpbDogJ2pvaG5AZXhhbXBsZS5jb20nXG4gICAgICAgIH0sXG4gICAgICAgIHRyYW5zZm9ybWVkOiB0cnVlXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgaGFuZGxlIG1pc3NpbmcgcmVsYXRpb25zIGdyYWNlZnVsbHknLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHkgPSB7XG4gICAgICAgIGlkOiAxLFxuICAgICAgICB0aXRsZTogJ1Rlc3QgRG9jdW1lbnQnXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBzY2hlbWEgPSB7IC4uLnRlc3RTY2hlbWEgfTtcbiAgICAgIG1vY2tFbnRpdHlTZXJ2aWNlLmdldEVudGl0eVNjaGVtYS5tb2NrUmV0dXJuVmFsdWUoc2NoZW1hKTtcblxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKGVudGl0eSk7XG5cbiAgICAgIGV4cGVjdChyZXN1bHQpLnRvRXF1YWwoe1xuICAgICAgICAuLi5lbnRpdHksXG4gICAgICAgIHRyYW5zZm9ybWVkOiB0cnVlXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgdXNlIGRlZmF1bHQgdHJhbnNmb3JtYXRpb24gd2hlbiBubyBzY2hlbWEgdHJhbnNmb3JtZXIgaXMgZGVmaW5lZCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eSA9IHsgaWQ6IDEsIHRpdGxlOiAnVGVzdCBEb2N1bWVudCcgfTtcbiAgICAgIGNvbnN0IHNjaGVtYSA9IHsgLi4udGVzdFNjaGVtYSB9O1xuXG4gICAgICAvLyBAdHMtaWdub3JlLW5leHQtbGluZVxuICAgICAgc2NoZW1hLm1vZGVsLnNlYXJjaC5kb2N1bWVudFRyYW5zZm9ybWVyID0gdW5kZWZpbmVkO1xuXG4gICAgICBtb2NrRW50aXR5U2VydmljZS5nZXRFbnRpdHlTY2hlbWEubW9ja1JldHVyblZhbHVlKHNjaGVtYSk7XG5cbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHNlcnZpY2UudHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZyhlbnRpdHkpO1xuXG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKGVudGl0eSk7XG4gICAgfSk7XG4gIH0pO1xufSk7XG4iXX0=