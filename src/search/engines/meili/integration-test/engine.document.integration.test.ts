import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, TEST_DOCS, pollForDocument, pollForDocumentAbsence } from './testUtils';

const TEST_INDEX = indexConfig.indexName;

describe('MeiliSearchEngine Document Operations Integration Tests', () => {
  let engine: MeiliSearchEngine;

  beforeAll(async () => {
    engine = new MeiliSearchEngine(config);
    // Clean up and create index
    try {
      const exists = await engine.indexExists(TEST_INDEX as string);
      if (exists) await engine.deleteIndex(TEST_INDEX as string, true);
    } catch { }
    await engine.initIndex({ ...indexConfig, indexName: TEST_INDEX as string }, true);
    await engine.indexDocuments(TEST_DOCS, { ...indexConfig, indexName: TEST_INDEX as string }, true);
    await pollForDocument(engine, { ...indexConfig, indexName: TEST_INDEX as string }, TEST_DOCS[ 0 ].id);
  }, 60000);

  afterAll(async () => {
    try {
      await engine.deleteIndex(TEST_INDEX as string);
    } catch { }
  }, 60000);

  it('should get a document by ID', async () => {
    const doc = await engine.getDocument('1', TEST_INDEX as string);
    expect(doc).toBeDefined();
    expect(doc.id).toBe('1');
    expect(doc.title).toBe('First document');
  }, 60000);

  it('should get multiple documents', async () => {
    const docs = await engine.getDocuments(TEST_INDEX as string, { limit: 3 });
    expect(docs).toBeDefined();
    expect(docs.length).toBe(3);
  }, 60000);

  it('should update a document', async () => {
    const updatedDoc = { id: '1', title: 'Updated first document' };
    await engine.updateDocuments([ updatedDoc ], { ...indexConfig, indexName: TEST_INDEX as string }, true);

    // Wait for the updated document to be available
    await new Promise(resolve => setTimeout(resolve, 1000));

    const doc = await engine.getDocument('1', TEST_INDEX as string);
    expect(doc.title).toBe('Updated first document');
    expect(doc.content).toBe('This is the first test document');
  }, 60000);

  it('should delete a document', async () => {
    await engine.deleteDocuments([ '5' ], TEST_INDEX as string, true);
    await pollForDocumentAbsence(engine, { ...indexConfig, indexName: TEST_INDEX as string }, '5');
    try {
      await engine.getDocument('5', TEST_INDEX as string);
      fail('Document should have been deleted');
    } catch (error) {
      expect(error).toBeDefined();
    }
    const doc = await engine.getDocument('4', TEST_INDEX as string);
    expect(doc).toBeDefined();
  }, 60000);

  it('should index documents in batches', async () => {
    const batchDocs = Array(10).fill(null).map((_, i) => ({
      id: `batch-${i}`,
      title: `Batch document ${i}`,
      content: `Content for batch document ${i}`,
      category: i % 2 === 0 ? 'even' : 'odd'
    }));
    await engine.indexInBatches(batchDocs, { ...indexConfig, indexName: TEST_INDEX as string }, 5, true);
    await pollForDocument(engine, { ...indexConfig, indexName: TEST_INDEX as string }, 'batch-0');
    const doc = await engine.getDocument('batch-0', TEST_INDEX as string);
    expect(doc).toBeDefined();
    expect(doc.title).toBe('Batch document 0');
    const ids = batchDocs.map(d => d.id);
    await engine.deleteDocuments(ids, TEST_INDEX as string, true);
    await pollForDocumentAbsence(engine, { ...indexConfig, indexName: TEST_INDEX as string }, 'batch-0');
  }, 60000);
}); 