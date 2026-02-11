"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_search_service_1 = require("./base-search-service");
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
                    searchableAttributes: ['title', 'description']
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
// Create a concrete implementation of BaseSearchService for testing
class TestSearchService extends base_search_service_1.BaseSearchService {
    async transformDocumentForIndexing(entity) {
        return { ...entity };
    }
}
let service;
let mockEntityService;
let mockSearchEngine;
let searchConfig;
let mockContext;
describe('BaseSearchService', () => {
    describe('search', () => {
        beforeEach(() => {
            mockEntityService = {
                hydrateRecords: jest.fn(),
                getEntitySearchConfig: jest.fn().mockReturnValue(searchConfig)
            };
            mockSearchEngine = {
                search: jest.fn(),
                indexDocuments: jest.fn(),
                deleteDocuments: jest.fn(),
            };
            searchConfig = testSchema.model.search.indexConfig;
            mockContext = {
                request: {},
                response: {},
                event: {},
                lambdaContext: {}
            };
            service = new TestSearchService(mockSearchEngine, searchConfig);
        });
        it('should perform basic search without attributes', async () => {
            const query = {
                search: 'test query'
            };
            const mockResults = {
                hits: [{ id: 1, title: 'Test Document' }],
                total: 1
            };
            mockSearchEngine.search.mockResolvedValue(mockResults);
            const result = await service.search(query, searchConfig, mockContext);
            expect(mockSearchEngine.search).toHaveBeenCalledWith(query, searchConfig);
            expect(result).toEqual(mockResults);
            expect(mockEntityService.hydrateRecords).not.toHaveBeenCalled();
        });
    });
    describe('syncToIndex', () => {
        beforeEach(() => {
            mockSearchEngine = {
                search: jest.fn(),
                indexDocuments: jest.fn(),
                deleteDocuments: jest.fn(),
            };
            searchConfig = {
                provider: 'meili',
                indexName: 'test-index',
                settings: {
                    searchableAttributes: ['title', 'description', 'author.name', 'author.email']
                }
            };
            service = new TestSearchService(mockSearchEngine, searchConfig);
        });
        it('should index a single document', async () => {
            const entity = { id: 1, title: 'Test Document' };
            const transformedDoc = { id: 1, title: 'Test Document' };
            jest.spyOn(service, 'transformDocumentForIndexing').mockResolvedValue(transformedDoc);
            await service.syncToIndex(entity);
            expect(service.transformDocumentForIndexing).toHaveBeenCalledWith(entity);
            expect(mockSearchEngine.indexDocuments).toHaveBeenCalledWith([transformedDoc], searchConfig, undefined);
        });
    });
    describe('bulkSync', () => {
        beforeEach(() => {
            mockSearchEngine = {
                search: jest.fn(),
                indexDocuments: jest.fn(),
                deleteDocuments: jest.fn(),
            };
            searchConfig = {
                provider: 'meili',
                indexName: 'test-index',
                settings: {
                    searchableAttributes: ['title', 'description', 'author.name', 'author.email']
                }
            };
            service = new TestSearchService(mockSearchEngine, searchConfig);
        });
        it('should index multiple documents', async () => {
            const entities = [
                { id: 1, title: 'Doc 1' },
                { id: 2, title: 'Doc 2' }
            ];
            const transformedDocs = [
                { id: 1, title: 'Doc 1' },
                { id: 2, title: 'Doc 2' }
            ];
            jest.spyOn(service, 'transformDocumentForIndexing')
                .mockResolvedValueOnce(transformedDocs[0])
                .mockResolvedValueOnce(transformedDocs[1]);
            await service.bulkSync(entities);
            expect(service.transformDocumentForIndexing).toHaveBeenCalledTimes(2);
            expect(mockSearchEngine.indexDocuments).toHaveBeenCalledWith(transformedDocs, searchConfig, undefined);
        });
    });
    describe('deleteFromIndex', () => {
        beforeEach(() => {
            mockSearchEngine = {
                search: jest.fn(),
                indexDocuments: jest.fn(),
                deleteDocuments: jest.fn(),
            };
            searchConfig = {
                provider: 'meili',
                indexName: 'test-index',
                settings: {
                    searchableAttributes: ['title', 'description', 'author.name', 'author.email']
                }
            };
            service = new TestSearchService(mockSearchEngine, searchConfig);
        });
        it('should delete a document by id', async () => {
            const entityId = '1';
            await service.deleteFromIndex(entityId);
            expect(mockSearchEngine.deleteDocuments).toHaveBeenCalledWith([entityId], searchConfig.indexName, undefined);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1zZWFyY2gtc2VydmljZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9zZXJ2aWNlcy9iYXNlLXNlYXJjaC1zZXJ2aWNlLnRlc3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwrREFBMEQ7QUFDMUQseUNBQXlIO0FBUXpILHVCQUF1QjtBQUN2QixNQUFNLFVBQVUsR0FBRyxJQUFBLDJCQUFrQixFQUFDO0lBQ3BDLEtBQUssRUFBRTtRQUNMLE1BQU0sRUFBRSxNQUFNO1FBQ2QsT0FBTyxFQUFFLE1BQU07UUFDZixPQUFPLEVBQUUsR0FBRztRQUNaLGdCQUFnQixFQUFFLE9BQU87UUFDekIsZ0JBQWdCLEVBQUUsZ0NBQXVCO1FBQ3pDLE1BQU0sRUFBRTtZQUNOLE9BQU8sRUFBRSxJQUFJO1lBQ2IsV0FBVyxFQUFFO2dCQUNYLFFBQVEsRUFBRSxPQUFPO2dCQUNqQixRQUFRLEVBQUU7b0JBQ1Isb0JBQW9CLEVBQUUsQ0FBRSxPQUFPLEVBQUUsYUFBYSxDQUFFO2lCQUNqRDthQUNGO1lBQ0QsbUJBQW1CLEVBQUUsQ0FBQyxNQUFXLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ3JDLEdBQUcsTUFBTTtnQkFDVCxXQUFXLEVBQUUsSUFBSTthQUNsQixDQUFDO1NBQ0g7S0FDRjtJQUNELFVBQVUsRUFBRTtRQUNWLEVBQUUsRUFBRTtZQUNGLElBQUksRUFBRSxRQUFRO1lBQ2QsUUFBUSxFQUFFLElBQUk7U0FDZjtRQUNELEtBQUssRUFBRTtZQUNMLElBQUksRUFBRSxRQUFRO1NBQ2Y7UUFDRCxNQUFNLEVBQUU7WUFDTixJQUFJLEVBQUUsS0FBSztZQUNYLFVBQVUsRUFBRTtnQkFDVixJQUFJLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2dCQUN4QixLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFO2FBQzFCO1NBQ0Y7S0FDRjtJQUNELE9BQU8sRUFBRTtRQUNQLE9B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Y2UgfSBmcm9tICcuL2Jhc2Utc2VhcmNoLXNlcnZpY2UnO1xuaW1wb3J0IHsgQmFzZUVudGl0eVNlcnZpY2UsIEVudGl0eVNjaGVtYSwgRW50aXR5UXVlcnksIGNyZWF0ZUVudGl0eVNjaGVtYSwgRGVmYXVsdEVudGl0eU9wZXJhdGlvbnMgfSBmcm9tICcuLi8uLi9lbnRpdHknO1xuaW1wb3J0IHsgU2VhcmNoSW5kZXhDb25maWcsIFNlYXJjaFJlc3VsdCB9IGZyb20gJy4uL3R5cGVzJztcbmltcG9ydCB7IEV4ZWN1dGlvbkNvbnRleHQgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzL2V4ZWN1dGlvbi1jb250ZXh0JztcbmltcG9ydCB7IEFQSUdhdGV3YXlFdmVudCwgQ29udGV4dCB9IGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgUmVxdWVzdCwgUmVzcG9uc2UgfSBmcm9tICcuLi8uLi9pbnRlcmZhY2VzJztcbmltcG9ydCB7IEJhc2VTZWFyY2hFbmdpbmUgfSBmcm9tICcuLi9lbmdpbmVzJztcblxuXG4vLyBDcmVhdGUgYSB0ZXN0IHNjaGVtYVxuY29uc3QgdGVzdFNjaGVtYSA9IGNyZWF0ZUVudGl0eVNjaGVtYSh7XG4gIG1vZGVsOiB7XG4gICAgZW50aXR5OiAndGVzdCcsXG4gICAgc2VydmljZTogJ3Rlc3QnLFxuICAgIHZlcnNpb246ICcxJyxcbiAgICBlbnRpdHlOYW1lUGx1cmFsOiAnVGVzdHMnLFxuICAgIGVudGl0eU9wZXJhdGlvbnM6IERlZmF1bHRFbnRpdHlPcGVyYXRpb25zLFxuICAgIHNlYXJjaDoge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIGluZGV4Q29uZmlnOiB7XG4gICAgICAgIHByb3ZpZGVyOiAnbWVpbGknLFxuICAgICAgICBzZXR0aW5nczoge1xuICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbICd0aXRsZScsICdkZXNjcmlwdGlvbicgXVxuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgZG9jdW1lbnRUcmFuc2Zvcm1lcjogKGVudGl0eTogYW55KSA9PiAoe1xuICAgICAgICAuLi5lbnRpdHksXG4gICAgICAgIHRyYW5zZm9ybWVkOiB0cnVlXG4gICAgICB9KVxuICAgIH1cbiAgfSxcbiAgYXR0cmlidXRlczoge1xuICAgIGlkOiB7XG4gICAgICB0eXBlOiAnbnVtYmVyJyxcbiAgICAgIHJlcXVpcmVkOiB0cnVlXG4gICAgfSxcbiAgICB0aXRsZToge1xuICAgICAgdHlwZTogJ3N0cmluZycsXG4gICAgfSxcbiAgICBhdXRob3I6IHtcbiAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBuYW1lOiB7IHR5cGU6ICdzdHJpbmcnIH0sXG4gICAgICAgIGVtYWlsOiB7IHR5cGU6ICdzdHJpbmcnIH1cbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIGluZGV4ZXM6IHtcbiAgICBwcmltYXJ5OiB7XG4gICAgICBwazoge1xuICAgICAgICBmaWVsZDogJ3BrJyxcbiAgICAgICAgY29tcG9zaXRlOiBbICdpZCcgXVxuICAgICAgfSxcbiAgICAgIHNrOiB7XG4gICAgICAgIGZpZWxkOiAnc2snLFxuICAgICAgICBjb21wb3NpdGU6IFsgJ2lkJyBdXG4gICAgICB9XG4gICAgfVxuICB9LFxufSBhcyBjb25zdCk7XG5cbnR5cGUgVGVzdFNjaGVtYSA9IHR5cGVvZiB0ZXN0U2NoZW1hO1xuXG4vLyBDcmVhdGUgYSBjb25jcmV0ZSBpbXBsZW1lbnRhdGlvbiBvZiBCYXNlU2VhcmNoU2VydmljZSBmb3IgdGVzdGluZ1xuY2xhc3MgVGVzdFNlYXJjaFNlcnZpY2UgZXh0ZW5kcyBCYXNlU2VhcmNoU2VydmljZSB7XG4gIGFzeW5jIHRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcoZW50aXR5OiBhbnkpOiBQcm9taXNlPFJlY29yZDxzdHJpbmcsIGFueT4+IHtcbiAgICByZXR1cm4geyAuLi5lbnRpdHkgfTtcbiAgfVxufVxuXG5sZXQgc2VydmljZTogVGVzdFNlYXJjaFNlcnZpY2U7XG5sZXQgbW9ja0VudGl0eVNlcnZpY2U6IGplc3QuTW9ja2VkPEJhc2VFbnRpdHlTZXJ2aWNlPFRlc3RTY2hlbWE+PjtcbmxldCBtb2NrU2VhcmNoRW5naW5lOiBqZXN0Lk1vY2tlZDxCYXNlU2VhcmNoRW5naW5lPjtcbmxldCBzZWFyY2hDb25maWc6IFNlYXJjaEluZGV4Q29uZmlnO1xubGV0IG1vY2tDb250ZXh0OiBFeGVjdXRpb25Db250ZXh0O1xuXG5kZXNjcmliZSgnQmFzZVNlYXJjaFNlcnZpY2UnLCAoKSA9PiB7XG4gIGRlc2NyaWJlKCdzZWFyY2gnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBtb2NrRW50aXR5U2VydmljZSA9IHtcbiAgICAgICAgaHlkcmF0ZVJlY29yZHM6IGplc3QuZm4oKSxcbiAgICAgICAgZ2V0RW50aXR5U2VhcmNoQ29uZmlnOiBqZXN0LmZuKCkubW9ja1JldHVyblZhbHVlKHNlYXJjaENvbmZpZylcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBtb2NrU2VhcmNoRW5naW5lID0ge1xuICAgICAgICBzZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgICAgaW5kZXhEb2N1bWVudHM6IGplc3QuZm4oKSxcbiAgICAgICAgZGVsZXRlRG9jdW1lbnRzOiBqZXN0LmZuKCksXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgc2VhcmNoQ29uZmlnID0gdGVzdFNjaGVtYS5tb2RlbC5zZWFyY2guaW5kZXhDb25maWc7XG5cbiAgICAgIG1vY2tDb250ZXh0ID0ge1xuICAgICAgICByZXF1ZXN0OiB7fSBhcyBSZXF1ZXN0LFxuICAgICAgICByZXNwb25zZToge30gYXMgUmVzcG9uc2UsXG4gICAgICAgIGV2ZW50OiB7fSBhcyBBUElHYXRld2F5RXZlbnQsXG4gICAgICAgIGxhbWJkYUNvbnRleHQ6IHt9IGFzIENvbnRleHRcbiAgICAgIH07XG5cbiAgICAgIHNlcnZpY2UgPSBuZXcgVGVzdFNlYXJjaFNlcnZpY2UobW9ja1NlYXJjaEVuZ2luZSwgc2VhcmNoQ29uZmlnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgcGVyZm9ybSBiYXNpYyBzZWFyY2ggd2l0aG91dCBhdHRyaWJ1dGVzJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgcXVlcnk6IEVudGl0eVF1ZXJ5PFRlc3RTY2hlbWE+ID0ge1xuICAgICAgICBzZWFyY2g6ICd0ZXN0IHF1ZXJ5J1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbW9ja1Jlc3VsdHM6IFNlYXJjaFJlc3VsdDxhbnk+ID0ge1xuICAgICAgICBoaXRzOiBbIHsgaWQ6IDEsIHRpdGxlOiAnVGVzdCBEb2N1bWVudCcgfSBdLFxuICAgICAgICB0b3RhbDogMVxuICAgICAgfTtcblxuICAgICAgbW9ja1NlYXJjaEVuZ2luZS5zZWFyY2gubW9ja1Jlc29sdmVkVmFsdWUobW9ja1Jlc3VsdHMpO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZXJ2aWNlLnNlYXJjaChxdWVyeSwgc2VhcmNoQ29uZmlnLCBtb2NrQ29udGV4dCk7XG5cbiAgICAgIGV4cGVjdChtb2NrU2VhcmNoRW5naW5lLnNlYXJjaCkudG9IYXZlQmVlbkNhbGxlZFdpdGgocXVlcnksIHNlYXJjaENvbmZpZyk7XG4gICAgICBleHBlY3QocmVzdWx0KS50b0VxdWFsKG1vY2tSZXN1bHRzKTtcbiAgICAgIGV4cGVjdChtb2NrRW50aXR5U2VydmljZS5oeWRyYXRlUmVjb3Jkcykubm90LnRvSGF2ZUJlZW5DYWxsZWQoKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ3N5bmNUb0luZGV4JywgKCkgPT4ge1xuICAgIGJlZm9yZUVhY2goKCkgPT4ge1xuICAgICAgbW9ja1NlYXJjaEVuZ2luZSA9IHtcbiAgICAgICAgc2VhcmNoOiBqZXN0LmZuKCksXG4gICAgICAgIGluZGV4RG9jdW1lbnRzOiBqZXN0LmZuKCksXG4gICAgICAgIGRlbGV0ZURvY3VtZW50czogamVzdC5mbigpLFxuICAgICAgfSBhcyBhbnk7XG5cbiAgICAgIHNlYXJjaENvbmZpZyA9IHtcbiAgICAgICAgcHJvdmlkZXI6ICdtZWlsaScsXG4gICAgICAgIGluZGV4TmFtZTogJ3Rlc3QtaW5kZXgnLFxuICAgICAgICBzZXR0aW5nczoge1xuICAgICAgICAgIHNlYXJjaGFibGVBdHRyaWJ1dGVzOiBbICd0aXRsZScsICdkZXNjcmlwdGlvbicsICdhdXRob3IubmFtZScsICdhdXRob3IuZW1haWwnIF1cbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgc2VydmljZSA9IG5ldyBUZXN0U2VhcmNoU2VydmljZShtb2NrU2VhcmNoRW5naW5lLCBzZWFyY2hDb25maWcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBpbmRleCBhIHNpbmdsZSBkb2N1bWVudCcsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0eSA9IHsgaWQ6IDEsIHRpdGxlOiAnVGVzdCBEb2N1bWVudCcgfSBhcyBhbnk7XG4gICAgICBjb25zdCB0cmFuc2Zvcm1lZERvYyA9IHsgaWQ6IDEsIHRpdGxlOiAnVGVzdCBEb2N1bWVudCcgfTtcblxuICAgICAgamVzdC5zcHlPbihzZXJ2aWNlLCAndHJhbnNmb3JtRG9jdW1lbnRGb3JJbmRleGluZycpLm1vY2tSZXNvbHZlZFZhbHVlKHRyYW5zZm9ybWVkRG9jKTtcblxuICAgICAgYXdhaXQgc2VydmljZS5zeW5jVG9JbmRleChlbnRpdHkpO1xuXG4gICAgICBleHBlY3Qoc2VydmljZS50cmFuc2Zvcm1Eb2N1bWVudEZvckluZGV4aW5nKS50b0hhdmVCZWVuQ2FsbGVkV2l0aChlbnRpdHkpO1xuICAgICAgZXhwZWN0KG1vY2tTZWFyY2hFbmdpbmUuaW5kZXhEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFsgdHJhbnNmb3JtZWREb2MgXSwgc2VhcmNoQ29uZmlnLCB1bmRlZmluZWQpO1xuICAgIH0pO1xuICB9KTtcblxuICBkZXNjcmliZSgnYnVsa1N5bmMnLCAoKSA9PiB7XG4gICAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgICBtb2NrU2VhcmNoRW5naW5lID0ge1xuICAgICAgICBzZWFyY2g6IGplc3QuZm4oKSxcbiAgICAgICAgaW5kZXhEb2N1bWVudHM6IGplc3QuZm4oKSxcbiAgICAgICAgZGVsZXRlRG9jdW1lbnRzOiBqZXN0LmZuKCksXG4gICAgICB9IGFzIGFueTtcblxuICAgICAgc2VhcmNoQ29uZmlnID0ge1xuICAgICAgICBwcm92aWRlcjogJ21laWxpJyxcbiAgICAgICAgaW5kZXhOYW1lOiAndGVzdC1pbmRleCcsXG4gICAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgICAgc2VhcmNoYWJsZUF0dHJpYnV0ZXM6IFsgJ3RpdGxlJywgJ2Rlc2NyaXB0aW9uJywgJ2F1dGhvci5uYW1lJywgJ2F1dGhvci5lbWFpbCcgXVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBzZXJ2aWNlID0gbmV3IFRlc3RTZWFyY2hTZXJ2aWNlKG1vY2tTZWFyY2hFbmdpbmUsIHNlYXJjaENvbmZpZyk7XG4gICAgfSk7XG5cbiAgICBpdCgnc2hvdWxkIGluZGV4IG11bHRpcGxlIGRvY3VtZW50cycsIGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGVudGl0aWVzID0gW1xuICAgICAgICB7IGlkOiAxLCB0aXRsZTogJ0RvYyAxJyB9LFxuICAgICAgICB7IGlkOiAyLCB0aXRsZTogJ0RvYyAyJyB9XG4gICAgICBdIGFzIGFueVtdO1xuXG4gICAgICBjb25zdCB0cmFuc2Zvcm1lZERvY3MgPSBbXG4gICAgICAgIHsgaWQ6IDEsIHRpdGxlOiAnRG9jIDEnIH0sXG4gICAgICAgIHsgaWQ6IDIsIHRpdGxlOiAnRG9jIDInIH1cbiAgICAgIF07XG5cbiAgICAgIGplc3Quc3B5T24oc2VydmljZSwgJ3RyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcnKVxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHRyYW5zZm9ybWVkRG9jc1sgMCBdKVxuICAgICAgICAubW9ja1Jlc29sdmVkVmFsdWVPbmNlKHRyYW5zZm9ybWVkRG9jc1sgMSBdKTtcblxuICAgICAgYXdhaXQgc2VydmljZS5idWxrU3luYyhlbnRpdGllcyk7XG5cbiAgICAgIGV4cGVjdChzZXJ2aWNlLnRyYW5zZm9ybURvY3VtZW50Rm9ySW5kZXhpbmcpLnRvSGF2ZUJlZW5DYWxsZWRUaW1lcygyKTtcbiAgICAgIGV4cGVjdChtb2NrU2VhcmNoRW5naW5lLmluZGV4RG9jdW1lbnRzKS50b0hhdmVCZWVuQ2FsbGVkV2l0aCh0cmFuc2Zvcm1lZERvY3MsIHNlYXJjaENvbmZpZywgdW5kZWZpbmVkKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgZGVzY3JpYmUoJ2RlbGV0ZUZyb21JbmRleCcsICgpID0+IHtcbiAgICBiZWZvcmVFYWNoKCgpID0+IHtcbiAgICAgIG1vY2tTZWFyY2hFbmdpbmUgPSB7XG4gICAgICAgIHNlYXJjaDogamVzdC5mbigpLFxuICAgICAgICBpbmRleERvY3VtZW50czogamVzdC5mbigpLFxuICAgICAgICBkZWxldGVEb2N1bWVudHM6IGplc3QuZm4oKSxcbiAgICAgIH0gYXMgYW55O1xuXG4gICAgICBzZWFyY2hDb25maWcgPSB7XG4gICAgICAgIHByb3ZpZGVyOiAnbWVpbGknLFxuICAgICAgICBpbmRleE5hbWU6ICd0ZXN0LWluZGV4JyxcbiAgICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogWyAndGl0bGUnLCAnZGVzY3JpcHRpb24nLCAnYXV0aG9yLm5hbWUnLCAnYXV0aG9yLmVtYWlsJyBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIHNlcnZpY2UgPSBuZXcgVGVzdFNlYXJjaFNlcnZpY2UobW9ja1NlYXJjaEVuZ2luZSwgc2VhcmNoQ29uZmlnKTtcbiAgICB9KTtcblxuICAgIGl0KCdzaG91bGQgZGVsZXRlIGEgZG9jdW1lbnQgYnkgaWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBlbnRpdHlJZCA9ICcxJztcblxuICAgICAgYXdhaXQgc2VydmljZS5kZWxldGVGcm9tSW5kZXgoZW50aXR5SWQpO1xuXG4gICAgICBleHBlY3QobW9ja1NlYXJjaEVuZ2luZS5kZWxldGVEb2N1bWVudHMpLnRvSGF2ZUJlZW5DYWxsZWRXaXRoKFsgZW50aXR5SWQgXSwgc2VhcmNoQ29uZmlnLmluZGV4TmFtZSEsIHVuZGVmaW5lZCk7XG4gICAgfSk7XG4gIH0pO1xufSk7Il19