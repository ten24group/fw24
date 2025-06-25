import { meiliSearchApiKeyDetailPage } from './meili-search-api-key-detail';
import { meiliSearchApiKeysPage } from './meili-search-api-keys';
import { meiliSearchCancelTasksPage } from './meili-search-cancel-tasks';
import { meiliSearchCreateApiKeyPage } from './meili-search-create-api-key';
import { meiliSearchCreateDumpPage } from './meili-search-create-dump';
import { meiliSearchCreateSnapshotPage } from './meili-search-create-snapshot';
import { meiliSearchDeleteTasksPage } from './meili-search-delete-tasks';
import { meiliSearchEditApiKeyPage } from './meili-search-edit-api-key';
import { meiliSearchExperimentalFeaturesPage } from './meili-experimental-features';
import { meiliSearchHealthPage } from './meili-search-health';
import { meiliSearchIndexDocumentsPage } from './meili-search-index-documents';
import { meiliSearchIsHealthyPage } from './meili-search-is-healthy';
import { meiliSearchMultiSearchPage } from './meili-search-multi-search';
import { meiliSearchStatsPage } from './meili-search-stats';
import { meiliSearchSwapIndicesPage } from './meili-search-swap-indices';
import { meiliSearchTaskDetailPage } from './meili-search-task-detail';
import { meiliSearchTasksPage } from './meili-search-tasks';
import { meiliSearchVersionPage } from './meili-search-version';
import { searchDashboardPage } from './search-dashboard';
import { searchCancelTasksConfig } from './search-cancel-tasks';
import { searchClearIndexDocumentsPage } from './search-clear-index-documents';
import { searchDeleteDocumentsByFilterPage } from './search-delete-documents-by-filter';
import { searchDeleteDocumentsByIdsPage } from './search-delete-documents-by-ids';
import { searchDeleteIndexPage } from './search-delete-index';
import { searchDeleteTasksConfig } from './search-delete-tasks';
import { searchEntitiesConfig } from './search-entities';
import { searchIndexDetailsConfig } from './search-index-details';
import { searchIndexSettingsConfig } from './search-index-settings';
import { searchIndicesConfig } from './search-indices';
import { searchInitIndicesPage } from './search-init-indices';
import { searchRecordDetailConfig } from './search-record-detail';
import { searchRecordsConfig } from './search-records';
import { searchResetIndexSettingsPage } from './search-reset-index-settings';
import { searchResyncPage } from './search-resync';
import { searchTaskDetailConfig } from './search-task-detail';
import { searchTasksConfig } from './search-tasks';
import { searchUpdateDocumentsPage } from './search-update-documents';


export const SearchCustomPageConfigs = {
  meiliSearchApiKeyDetailPage,
  meiliSearchApiKeysPage,
  meiliSearchCancelTasksPage,
  meiliSearchCreateApiKeyPage,
  meiliSearchCreateDumpPage,
  meiliSearchCreateSnapshotPage,
  meiliSearchDeleteTasksPage,
  meiliSearchEditApiKeyPage,
  meiliSearchExperimentalFeaturesPage,
  meiliSearchHealthPage,
  meiliSearchIndexDocumentsPage,
  meiliSearchIsHealthyPage,
  meiliSearchMultiSearchPage,
  meiliSearchStatsPage,
  meiliSearchSwapIndicesPage,
  meiliSearchTaskDetailPage,
  meiliSearchTasksPage,
  meiliSearchVersionPage,
  searchDashboardPage,
  searchCancelTasksConfig,
  searchClearIndexDocumentsPage,
  searchDeleteDocumentsByFilterPage,
  searchDeleteDocumentsByIdsPage,
  searchDeleteIndexPage,
  searchDeleteTasksConfig,
  searchEntitiesConfig,
  searchIndexDetailsConfig,
  searchIndexSettingsConfig,
  searchIndicesConfig,
  searchInitIndicesPage,
  searchRecordDetailConfig,
  searchRecordsConfig,
  searchResetIndexSettingsPage,
  searchResyncPage,
  searchTaskDetailConfig,
  searchTasksConfig,
  searchUpdateDocumentsPage,
} as const;