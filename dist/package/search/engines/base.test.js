"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const base_1 = require("./base");
// Create a concrete implementation of BaseSearchEngine for testing
class TestSearchEngine extends base_1.BaseSearchEngine {
    indexExists(_indexName) {
        throw new Error("Method not implemented.");
    }
    deleteIndex(_indexName, _synchronous) {
        throw new Error("Method not implemented.");
    }
    getIndexInfo(_indexName) {
        throw new Error("Method not implemented.");
    }
    getIndexStats(_indexName) {
        throw new Error("Method not implemented.");
    }
    listIndices() {
        throw new Error("Method not implemented.");
    }
    updateIndexSettings(_indexName, _settings, _synchronous) {
        throw new Error("Method not implemented.");
    }
    resetIndexSettings(_indexName, _synchronous) {
        throw new Error("Method not implemented.");
    }
    getIndexSettings(_indexName) {
        throw new Error("Method not implemented.");
    }
    updateDocuments(_docs, _config, _synchronous) {
        throw new Error("Method not implemented.");
    }
    getDocument(_id, _indexName) {
        throw new Error("Method not implemented.");
    }
    getDocuments(_indexName, _options) {
        throw new Error("Method not implemented.");
    }
    deleteAllDocuments(_indexName, _synchronous) {
        throw new Error("Method not implemented.");
    }
    deleteDocumentsByFilter(_filter, _indexName, _synchronous) {
        throw new Error("Method not implemented.");
    }
    health() {
        throw new Error("Method not implemented.");
    }
    isHealthy() {
        throw new Error("Method not implemented.");
    }
    getStats() {
        throw new Error("Method not implemented.");
    }
    getVersion() {
        throw new Error("Method not implemented.");
    }
    multiSearch(_queries) {
        throw new Error("Method not implemented.");
    }
    async indexDocuments(_documents, config) {
        this.validateConfig(config);
    }
    async search(query, config) {
        this.validateConfig(config);
        return { ...query };
    }
    async deleteDocuments(_ids, _indexName) {
        // Implementation not needed for tests
    }
    async initIndex(_config) {
        // Implementation not needed for tests
    }
}
describe('BaseSearchEngine', () => {
    let engine;
    let config;
    beforeEach(() => {
        engine = new TestSearchEngine({});
        config = {
            provider: 'meili',
            indexName: 'test-index',
            settings: {
                searchableAttributes: ['title', 'description'],
                filterableAttributes: ['category', 'status']
            }
        };
    });
    describe('validateConfig', () => {
        it('should throw error when indexName is missing', async () => {
            const invalidConfig = { ...config, indexName: undefined };
            await expect(engine.indexDocuments([], invalidConfig)).rejects.toThrow('Index name is required');
        });
        it('should not throw error when indexName is provided', async () => {
            await expect(engine.indexDocuments([], config)).resolves.not.toThrow();
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS50ZXN0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlYXJjaC9lbmdpbmVzL2Jhc2UudGVzdC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBLGlDQUEwQztBQUsxQyxtRUFBbUU7QUFDbkUsTUFBTSxnQkFBaUIsU0FBUSx1QkFBZ0I7SUFDN0MsV0FBVyxDQUFDLFVBQWtCO1FBQzVCLE1BQU0sSUFBSSxLQUFLLENBQUMseUJBQXlCLENBQUMsQ0FBQztJQUM3QyxDQUFDO0lBQ0QsV0FBVyxDQUFDLFVBQWtCLEVBQUUsWUFBc0I7UUFDcEQsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFDRCxZQUFZLENBQUMsVUFBa0I7UUFDN0IsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFDRCxhQUFhLENBQUMsVUFBa0I7UUFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFDRCxXQUFXO1FBQ1QsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFDRCxtQkFBbUIsQ0FBQyxVQUFrQixFQUFFLFNBQWMsRUFBRSxZQUFzQjtRQUM1RSxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUNELGtCQUFrQixDQUFDLFVBQWtCLEVBQUUsWUFBc0I7UUFDM0QsTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFDRCxnQkFBZ0IsQ0FBQyxVQUFrQjtRQUNqQyxNQUFNLElBQUksS0FBSyxDQUFDLHlCQUF5QixDQUFDLENBQUM7SUFDN0MsQ0FBQztJQUNELGVBQWUsQ0FBc0QsS0FBVSxFQUFFLE9BQTBCLEVBQUUsWUFBc0I7UUFDakksTUFBTSxJQUFJLEtBQUssQ0FBQyx5QkFB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USxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUN6RSxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUMsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBCYXNlU2VhcmNoRW5naW5lIH0gZnJvbSBcIi4vYmFzZVwiO1xuaW1wb3J0IHsgU2VhcmNoSW5kZXhDb25maWcsIFNlYXJjaFF1ZXJ5IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5pbXBvcnQgeyBFbnRpdHlRdWVyeSB9IGZyb20gXCIuLi8uLi9lbnRpdHkvcXVlcnktdHlwZXNcIjtcbmltcG9ydCB7IEVudGl0eVNjaGVtYSB9IGZyb20gXCIuLi8uLi9lbnRpdHlcIjtcblxuLy8gQ3JlYXRlIGEgY29uY3JldGUgaW1wbGVtZW50YXRpb24gb2YgQmFzZVNlYXJjaEVuZ2luZSBmb3IgdGVzdGluZ1xuY2xhc3MgVGVzdFNlYXJjaEVuZ2luZSBleHRlbmRzIEJhc2VTZWFyY2hFbmdpbmUge1xuICBpbmRleEV4aXN0cyhfaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBkZWxldGVJbmRleChfaW5kZXhOYW1lOiBzdHJpbmcsIF9zeW5jaHJvbm91cz86IGJvb2xlYW4pOiBQcm9taXNlPGFueT4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIGdldEluZGV4SW5mbyhfaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIGdldEluZGV4U3RhdHMoX2luZGV4TmFtZTogc3RyaW5nKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBsaXN0SW5kaWNlcygpOiBQcm9taXNlPGFueT4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIHVwZGF0ZUluZGV4U2V0dGluZ3MoX2luZGV4TmFtZTogc3RyaW5nLCBfc2V0dGluZ3M6IGFueSwgX3N5bmNocm9ub3VzPzogYm9vbGVhbik6IFByb21pc2U8YW55PiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kIG5vdCBpbXBsZW1lbnRlZC5cIik7XG4gIH1cbiAgcmVzZXRJbmRleFNldHRpbmdzKF9pbmRleE5hbWU6IHN0cmluZywgX3N5bmNocm9ub3VzPzogYm9vbGVhbik6IFByb21pc2U8YW55PiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kIG5vdCBpbXBsZW1lbnRlZC5cIik7XG4gIH1cbiAgZ2V0SW5kZXhTZXR0aW5ncyhfaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPGFueT4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIHVwZGF0ZURvY3VtZW50czxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55PiA9IFJlY29yZDxzdHJpbmcsIGFueT4+KF9kb2NzOiBUW10sIF9jb25maWc6IFNlYXJjaEluZGV4Q29uZmlnLCBfc3luY2hyb25vdXM/OiBib29sZWFuKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBnZXREb2N1bWVudDxUIGV4dGVuZHMgUmVjb3JkPHN0cmluZywgYW55PiA9IFJlY29yZDxzdHJpbmcsIGFueT4+KF9pZDogc3RyaW5nLCBfaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPFQ+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBnZXREb2N1bWVudHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4gPSBSZWNvcmQ8c3RyaW5nLCBhbnk+PihfaW5kZXhOYW1lOiBzdHJpbmcsIF9vcHRpb25zPzogYW55KTogUHJvbWlzZTxUW10+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBkZWxldGVBbGxEb2N1bWVudHMoX2luZGV4TmFtZTogc3RyaW5nLCBfc3luY2hyb25vdXM/OiBib29sZWFuKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBkZWxldGVEb2N1bWVudHNCeUZpbHRlcihfZmlsdGVyOiBTZWFyY2hRdWVyeVsgXCJmaWx0ZXJzXCIgXSwgX2luZGV4TmFtZTogc3RyaW5nLCBfc3luY2hyb25vdXM/OiBib29sZWFuKTogUHJvbWlzZTxhbnk+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJNZXRob2Qgbm90IGltcGxlbWVudGVkLlwiKTtcbiAgfVxuICBoZWFsdGg8VCA9IGFueT4oKTogUHJvbWlzZTxUPiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kIG5vdCBpbXBsZW1lbnRlZC5cIik7XG4gIH1cbiAgaXNIZWFsdGh5KCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIGdldFN0YXRzPFQgPSBhbnk+KCk6IFByb21pc2U8VD4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcIk1ldGhvZCBub3QgaW1wbGVtZW50ZWQuXCIpO1xuICB9XG4gIGdldFZlcnNpb248VCA9IGFueT4oKTogUHJvbWlzZTxUPiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kIG5vdCBpbXBsZW1lbnRlZC5cIik7XG4gIH1cbiAgbXVsdGlTZWFyY2g8VCA9IGFueT4oX3F1ZXJpZXM6IGFueVtdKTogUHJvbWlzZTxUPiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiTWV0aG9kIG5vdCBpbXBsZW1lbnRlZC5cIik7XG4gIH1cbiAgYXN5bmMgaW5kZXhEb2N1bWVudHM8VCBleHRlbmRzIFJlY29yZDxzdHJpbmcsIGFueT4+KF9kb2N1bWVudHM6IFRbXSwgY29uZmlnOiBTZWFyY2hJbmRleENvbmZpZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgfVxuXG4gIGFzeW5jIHNlYXJjaDxUIGV4dGVuZHMgRW50aXR5U2NoZW1hPGFueSwgYW55LCBhbnk+PihxdWVyeTogRW50aXR5UXVlcnk8VD4sIGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWcpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcbiAgICByZXR1cm4geyAuLi5xdWVyeSB9O1xuICB9XG5cbiAgYXN5bmMgZGVsZXRlRG9jdW1lbnRzKF9pZHM6IHN0cmluZ1tdLCBfaW5kZXhOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBub3QgbmVlZGVkIGZvciB0ZXN0c1xuICB9XG5cbiAgYXN5bmMgaW5pdEluZGV4KF9jb25maWc6IFNlYXJjaEluZGV4Q29uZmlnKTogUHJvbWlzZTxhbnk+IHtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBub3QgbmVlZGVkIGZvciB0ZXN0c1xuICB9XG5cblxufVxuXG5kZXNjcmliZSgnQmFzZVNlYXJjaEVuZ2luZScsICgpID0+IHtcbiAgbGV0IGVuZ2luZTogVGVzdFNlYXJjaEVuZ2luZTtcbiAgbGV0IGNvbmZpZzogU2VhcmNoSW5kZXhDb25maWc7XG5cbiAgYmVmb3JlRWFjaCgoKSA9PiB7XG4gICAgZW5naW5lID0gbmV3IFRlc3RTZWFyY2hFbmdpbmUoe30pO1xuICAgIGNvbmZpZyA9IHtcbiAgICAgIHByb3ZpZGVyOiAnbWVpbGknLFxuICAgICAgaW5kZXhOYW1lOiAndGVzdC1pbmRleCcsXG4gICAgICBzZXR0aW5nczoge1xuICAgICAgICBzZWFyY2hhYmxlQXR0cmlidXRlczogWyAndGl0bGUnLCAnZGVzY3JpcHRpb24nIF0sXG4gICAgICAgIGZpbHRlcmFibGVBdHRyaWJ1dGVzOiBbICdjYXRlZ29yeScsICdzdGF0dXMnIF1cbiAgICAgIH1cbiAgICB9O1xuICB9KTtcblxuICBkZXNjcmliZSgndmFsaWRhdGVDb25maWcnLCAoKSA9PiB7XG4gICAgaXQoJ3Nob3VsZCB0aHJvdyBlcnJvciB3aGVuIGluZGV4TmFtZSBpcyBtaXNzaW5nJywgYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgaW52YWxpZENvbmZpZyA9IHsgLi4uY29uZmlnLCBpbmRleE5hbWU6IHVuZGVmaW5lZCB9O1xuICAgICAgYXdhaXQgZXhwZWN0KGVuZ2luZS5pbmRleERvY3VtZW50cyhbXSwgaW52YWxpZENvbmZpZykpLnJlamVjdHMudG9UaHJvdygnSW5kZXggbmFtZSBpcyByZXF1aXJlZCcpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3Nob3VsZCBub3QgdGhyb3cgZXJyb3Igd2hlbiBpbmRleE5hbWUgaXMgcHJvdmlkZWQnLCBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCBleHBlY3QoZW5naW5lLmluZGV4RG9jdW1lbnRzKFtdLCBjb25maWcpKS5yZXNvbHZlcy5ub3QudG9UaHJvdygpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19