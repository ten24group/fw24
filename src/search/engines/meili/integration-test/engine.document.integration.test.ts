import { MeiliSearchEngine } from '../engine';
import { config, indexConfig, TEST_DOCS, pollForDocument, pollForDocumentAbsence } from './testUtils';

const TEST_INDEX = indexConfig.indexName + '-document';

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

  it('should update documents in batches', async () => {
    const tempIndex = `test-update-batch-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };
    const docs = [
      { id: '1', title: 'Doc 1', content: 'A' },
      { id: '2', title: 'Doc 2', content: 'B' },
      { id: '3', title: 'Doc 3', content: 'C' }
    ];
    try {
      await engine.initIndex(tempConfig, true);
      await engine.indexDocuments(docs, tempConfig, true);
      await pollForDocument(engine, tempConfig, '1');

      await engine.updateDocumentsInBatches([
        { id: '1', title: 'Updated 1' },
        { id: '2', title: 'Updated 2' },
        { id: '3', title: 'Updated 3' }
      ], tempConfig, 2, true);

      await new Promise(resolve => setTimeout(resolve, 1000));

      const doc1 = await engine.getDocument('1', tempIndex);
      expect(doc1.title).toBe('Updated 1');
      const doc2 = await engine.getDocument('2', tempIndex);
      expect(doc2.title).toBe('Updated 2');
      const doc3 = await engine.getDocument('3', tempIndex);
      expect(doc3.title).toBe('Updated 3');
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  });

  it('should delete all documents in an index', async () => {
    const tempIndex = `test-delete-all-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = { ...indexConfig, indexName: tempIndex };

    try {

      await engine.initIndex(tempConfig, true);
      await engine.indexDocuments([
        { id: '1', title: 'Doc 1' },
        { id: '2', title: 'Doc 2' }
      ], tempConfig, true);
      await pollForDocument(engine, tempConfig, '1');

      await engine.deleteAllDocuments(tempIndex, true);
      await pollForDocumentAbsence(engine, tempConfig, '1');

      const docs = await engine.getDocuments(tempIndex);
      expect(docs.length).toBe(0);
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  });

  it('should delete documents by filter', async () => {
    const tempIndex = `test-delete-filter-${Math.random().toString(36).substring(2, 10)}`;
    const tempConfig = {
      ...indexConfig,
      settings: {
        ...(indexConfig.settings || {}),
        filterableAttributes: [ ...(indexConfig.settings?.filterableAttributes || []), 'group' ]
      },
      indexName: tempIndex
    };
    try {
      await engine.initIndex(tempConfig, true);
      await engine.indexDocuments([
        { id: '1', title: 'Doc 1', group: 'A' },
        { id: '2', title: 'Doc 2', group: 'B' },
        { id: '3', title: 'Doc 3', group: 'A' }
      ], tempConfig, true);

      await pollForDocument(engine, tempConfig, '1');

      // make sure the attribute is filterable
      await engine.deleteDocumentsByFilter({ group: { eq: 'A' } }, tempIndex, true);

      await pollForDocumentAbsence(engine, tempConfig, '1', 40);

      const docs = await engine.getDocuments(tempIndex);
      expect(docs.length).toBe(1);
      expect(docs[ 0 ].group).toBe('B');
    } finally {
      await engine.deleteIndex(tempIndex, true);
    }
  });
}); 