import { MeiliSearchEngine, ExtendedMeiliSearchClientConfig, SearchIndexConfigExt } from '../engine';

export const TEST_DOCS = [
  { id: '1', title: 'First document', content: 'This is the first test document', category: 'test', tags: [ 'doc', 'first' ], price: 10, status: 'active' },
  { id: '2', title: 'Second document', content: 'This is the second test document', category: 'test', tags: [ 'doc', 'second' ], price: 20, status: 'active' },
  { id: '3', title: 'Third document', content: 'This is the third test document', category: 'tutorial', tags: [ 'doc', 'third' ], price: 30, status: 'archived' },
  { id: '4', title: 'Fourth document with special term', content: 'This document contains a special search term: xylophone', category: 'tutorial', tags: [ 'doc', 'special' ], price: 40, status: 'active' },
  { id: '5', title: 'Fifth document', content: 'This is the fifth test document with a special search: quick brown fox jumps over the lazy dog', category: 'guide', tags: [ 'doc', 'guide' ], price: 50, status: 'draft' },
];

export const TEST_VECTOR_DOCS = [
  { id: 'v1', title: 'Vector document 1', content: 'Vector content 1', _vectors: { default: [ 0.1, 0.2, 0.3 ] } },
  { id: 'v2', title: 'Vector document 2', content: 'Vector content 2', _vectors: { default: [ 0.2, 0.3, 0.4 ] } },
  { id: 'v3', title: 'Vector document 3', content: 'Vector content 3', _vectors: { default: [ 0.3, 0.4, 0.5 ] } },
];

export const config: ExtendedMeiliSearchClientConfig = {
  host: 'http://localhost:7700',
  apiKey: 'xxx_your_master_key',
};

export const indexConfig: SearchIndexConfigExt = {
  indexName: 'test-integration-index',
  primaryKey: 'id',
  settings: {
    searchableAttributes: [ 'title', 'content', 'tags' ],
    filterableAttributes: [ 'category', 'tags', 'price', 'status' ],
    sortableAttributes: [ 'price' ],
  }
};

export async function pollForDocument(
  engine: MeiliSearchEngine,
  indexConfig: SearchIndexConfigExt,
  docId: string,
  maxAttempts = 20,
  interval = 100
) {
  const indexName = indexConfig.indexName as string;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const doc = await engine.getDocument(docId, indexName);
      if (doc) return;
    } catch (e) { }
    await new Promise(res => setTimeout(res, interval));
  }
  throw new Error(`Document ${docId} not available in index ${indexConfig.indexName} after ${maxAttempts * interval}ms`);
}

export async function pollForDocumentAbsence(
  engine: MeiliSearchEngine,
  indexConfig: SearchIndexConfigExt,
  docId: string,
  maxAttempts = 20,
  interval = 100
) {
  const indexName = indexConfig.indexName as string;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await engine.getDocument(docId, indexName);
    } catch (e) {
      return;
    }
    await new Promise(res => setTimeout(res, interval));
  }
  throw new Error(`Document ${docId} still present in index ${indexConfig.indexName} after ${maxAttempts * interval}ms`);
}

export async function pollForSetting(
  engine: MeiliSearchEngine,
  indexName: string,
  key: string,
  expected: any,
  maxAttempts = 20,
  interval = 100
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const settings = await engine.getIndexSettings(indexName) as { [ key: string ]: any };
    if (JSON.stringify(settings[ key ]) === JSON.stringify(expected)) return;
    await new Promise(res => setTimeout(res, interval));
  }
  throw new Error(`Setting ${key} not updated to ${JSON.stringify(expected)} after ${maxAttempts * interval}ms`);
} 