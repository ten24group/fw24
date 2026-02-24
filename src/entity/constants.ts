/**
 * Default entity operations that are commonly used.
 * Use this as a base or define your own subset/superset.
 */
export const DefaultEntityOperations = {
  get: { enabled: true, method: 'GET', path: '/{id}', handler: 'get', requiresId: true, label: 'View' },
  list: { enabled: true, method: 'GET', path: '/', handler: 'list', label: 'List' },
  query: { enabled: true, method: 'POST', path: '/query', handler: 'query', label: 'Query' },
  search: { enabled: true, method: 'POST', path: '/search', handler: 'search', label: 'Search' },
  create: { enabled: true, method: 'POST', path: '/', handler: 'create', label: 'Create' },
  upsert: { enabled: true, method: 'POST', path: '/upsert', handler: 'upsert', label: 'Upsert' },
  update: { enabled: true, method: 'PATCH', path: '/{id}', handler: 'update', requiresId: true, label: 'Edit' },
  delete: { enabled: true, method: 'DELETE', path: '/{id}', handler: 'delete', requiresId: true, label: 'Delete' },
  duplicate: { enabled: true, method: 'GET', path: '/duplicate/{id}', handler: 'duplicate', requiresId: true, label: 'Duplicate' },
  batchUpsert: { enabled: false, method: 'POST', path: '/batch-upsert', handler: 'batchUpsert', isBulk: true, label: 'Batch Upsert' },
  batchDelete: { enabled: false, method: 'POST', path: '/batch-delete', handler: 'batchDelete', isBulk: true, label: 'Batch Delete' },
  deleteByQuery: { enabled: false, method: 'POST', path: '/delete-by-query', handler: 'deleteByQuery', isBulk: true, label: 'Delete By Query' },
  export: { enabled: false, method: 'POST', path: '/export', handler: 'export', isBulk: true, label: 'Export', uiLocation: 'header', icon: 'DownloadOutlined' },
  import: { enabled: false, method: 'POST', path: '/import', handler: 'import', isBulk: true, label: 'Import', uiLocation: 'header', icon: 'UploadOutlined' },
  patch: { enabled: false, method: 'PATCH', path: '/batch-patch', handler: 'patch', isBulk: true, label: 'Batch Patch', uiLocation: 'bulk', icon: 'EditOutlined' },
  restore: { enabled: false, method: 'POST', path: '/{id}/restore', handler: 'restore', requiresId: true, label: 'Restore', uiLocation: 'row', icon: 'UndoOutlined' },
  archive: { enabled: false, method: 'POST', path: '/{id}/archive', handler: 'archive', requiresId: true, label: 'Archive', uiLocation: 'row', icon: 'FolderAddOutlined' },
  geoSearch: { enabled: false, method: 'POST', path: '/geo-search', handler: 'geoSearch', label: 'Geo Search', icon: 'EnvironmentOutlined' },
  getAncestors: { enabled: false, method: 'GET', path: '/{id}/ancestors', handler: 'getAncestors', requiresId: true, label: 'View Ancestors' },
  getDescendants: { enabled: false, method: 'GET', path: '/{id}/descendants', handler: 'getDescendants', requiresId: true, label: 'View Descendants' },
  attach: { enabled: false, method: 'POST', path: '/{id}/attach', handler: 'attach', requiresId: true, label: 'Attach Relation' },
  detach: { enabled: false, method: 'POST', path: '/{id}/detach', handler: 'detach', requiresId: true, label: 'Detach Relation' },
} as const;
