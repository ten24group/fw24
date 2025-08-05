import { meiliSearchApiKeyDetailPage } from './meili-search-api-key-detail';
import { meiliSearchApiKeysPage } from './meili-search-api-keys';
import { meiliSearchCreateApiKeyPage } from './meili-search-create-api-key';
import { meiliSearchEditApiKeyPage } from './meili-search-edit-api-key';
import { meiliSearchExperimentalFeaturesPage } from './meili-experimental-features';
import { meiliSearchTaskDetailPage } from './meili-search-task-detail';
import { meiliSearchTasksPage } from './meili-search-tasks';
import { searchDashboardPage } from './search-dashboard';
import { searchEntitiesConfig } from './search-entities';
import { searchIndexDetailsConfig } from './search-index-details';
import { searchIndexSettingsConfig } from './search-index-settings';
import { searchIndicesConfig } from './search-indices';
import { searchRecordDetailConfig } from './search-record-detail';
import { searchRecordsConfig } from './search-records';


export const SearchCustomPageConfigs = {
  meiliSearchApiKeyDetailPage,
  meiliSearchApiKeysPage,
  meiliSearchCreateApiKeyPage,
  meiliSearchEditApiKeyPage,
  meiliSearchExperimentalFeaturesPage,
  meiliSearchTaskDetailPage,
  meiliSearchTasksPage,
  searchDashboardPage,
  searchEntitiesConfig,
  searchIndexDetailsConfig,
  searchIndexSettingsConfig,
  searchIndicesConfig,
  searchRecordDetailConfig,
  searchRecordsConfig,
} as const;