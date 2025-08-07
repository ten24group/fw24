import { FormPageConfig } from "../../../ui-config-gen";

export const searchIndexSettingsFormConfig: FormPageConfig = {
  pageTitle: "Search Index Settings",
  pageType: "form",
  routePattern: "/system/search/indices/:entityName/settings-edit",
  breadcrumbs: [
    { label: "Home", url: "/" },
    { label: "Search", url: "/system/search" },
    { label: "Indices", url: "/system/search/indices" },
    { label: "Index Details", url: "/system/search/indices/:entityName" },
    { label: "Settings Details", url: "/system/search/indices/:entityName/settings-details" },
    { label: "Edit Settings" }
  ],
  formPageConfig: {
    detailApiConfig: {
      apiMethod: "GET",
      apiUrl: "/system/search/indices/:entityName/settings"
    },
    apiConfig: {
      apiMethod: "PUT",
      responseKey: "result",
      apiUrl: "/system/search/indices/:entityName/settings"
    },
    formButtons: [ "submit", "reset", { text: "Cancel", url: "/system/search/indices/:entityName/settings-details" } ],
    propertiesConfig: [
      { 
        name: "settings", 
        label: "Search Index Settings", 
        column: "settings", 
        fieldType: "object",
        type: 'map',
        helpText: "Configure all search index settings for this index.",
        properties: [
          { 
            name: "displayedAttributes", 
            label: "Displayed Attributes", 
            column: "displayedAttributes", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of attributes to display in the search results. Use '*' for all attributes.",
            defaultValue: ["*"]
          },
          { 
            name: "searchableAttributes", 
            label: "Searchable Attributes", 
            column: "searchableAttributes", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of attributes that the search engine can search through. Use '*' for all attributes.",
            defaultValue: ["*"]
          },
          { 
            name: "filterableAttributes", 
            label: "Filterable Attributes", 
            column: "filterableAttributes", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of attributes that can be used as filters.",
            defaultValue: []
          },
          { 
            name: "sortableAttributes", 
            label: "Sortable Attributes", 
            column: "sortableAttributes", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of attributes that can be used for sorting search results.",
            defaultValue: []
          },
          { 
            name: "rankingRules", 
            label: "Ranking Rules", 
            column: "rankingRules", 
            fieldType: "multi-select",
            options: [
                { value: "words", label: "Words" },
                { value: "typo", label: "Typo" },
                { value: "proximity", label: "Proximity" },
                { value: "attribute", label: "Attribute" },
                { value: "sort", label: "Sort" },
                { value: "exactness", label: "Exactness" }
            ],
            helpText: "The order of ranking rules for search results. Order matters.",
            defaultValue: ["words", "typo", "proximity", "attribute", "sort", "exactness"]
          },
          { 
            name: "stopWords", 
            label: "Stop Words", 
            column: "stopWords", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of words that will be ignored by the search engine.",
            defaultValue: []
          },
          { 
            name: "nonSeparatorTokens", 
            label: "Non-Separator Tokens", 
            column: "nonSeparatorTokens", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of tokens that should not be treated as separators.",
            defaultValue: []
          },
          { 
            name: "separatorTokens", 
            label: "Separator Tokens", 
            column: "separatorTokens", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of tokens that should be treated as separators.",
            defaultValue: []
          },
          { 
            name: "dictionary", 
            label: "Dictionary", 
            column: "dictionary", 
            fieldType: "list",
            type: 'list',
            items: { type: 'text' },
            helpText: "List of words to be added to the dictionary.",
            defaultValue: []
          },
          { 
            name: "synonyms", 
            label: "Synonyms", 
            column: "synonyms", 
            fieldType: "json",
            placeholder: "{\"wolverine\": [\"xmen\", \"logan\"], \"logan\": [\"wolverine\", \"xmen\"]}",
            helpText: "Define sets of words that should be considered equivalent. Each key should map to an array of strings. Example: {\"wolverine\": [\"xmen\", \"logan\"]}",
            defaultValue: "{}"
          },
          { 
            name: "distinctAttribute", 
            label: "Distinct Attribute", 
            column: "distinctAttribute", 
            fieldType: "text",
            placeholder: "Enter attribute name or leave empty for null",
            helpText: "An attribute to ensure there are no duplicate documents in the results. Can be null.",
            defaultValue: null
          },
          { 
            name: "typoTolerance", 
            label: "Typo Tolerance", 
            column: "typoTolerance", 
            fieldType: "object",
            type: 'map',
            helpText: "Configure the tolerance for typos in search queries.",
            properties: [
              {
                name: "enabled",
                label: "Enabled",
                column: "enabled",
                fieldType: "boolean",
                helpText: "Enable or disable typo tolerance.",
                defaultValue: true
              },
              {
                name: "minWordSizeForTypos",
                label: "Minimum Word Size for Typos",
                column: "minWordSizeForTypos",
                fieldType: "object",
                type: 'map',
                helpText: "Configure minimum word size for typo tolerance.",
                properties: [
                  {
                    name: "oneTypo",
                    label: "One Typo",
                    column: "oneTypo",
                    fieldType: "number",
                    helpText: "Minimum word size for one typo.",
                    defaultValue: 5
                  },
                  {
                    name: "twoTypos",
                    label: "Two Typos",
                    column: "twoTypos",
                    fieldType: "number",
                    helpText: "Minimum word size for two typos.",
                    defaultValue: 9
                  }
                ]
              },
              {
                name: "disableOnWords",
                label: "Disable On Words",
                column: "disableOnWords",
                fieldType: "list",
                type: 'list',
                items: { type: 'text' },
                helpText: "List of words to disable typo tolerance on.",
                defaultValue: []
              },
              {
                name: "disableOnAttributes",
                label: "Disable On Attributes",
                column: "disableOnAttributes",
                fieldType: "list",
                type: 'list',
                items: { type: 'text' },
                helpText: "List of attributes to disable typo tolerance on.",
                defaultValue: []
              }
            ]
          },
          { 
            name: "faceting", 
            label: "Faceting", 
            column: "faceting", 
            fieldType: "object",
            type: 'map',
            helpText: "Configure settings for faceted search.",
            properties: [
              {
                name: "maxValuesPerFacet",
                label: "Max Values Per Facet",
                column: "maxValuesPerFacet",
                fieldType: "number",
                helpText: "Maximum number of values per facet.",
                defaultValue: 100
              },
              {
                name: "sortFacetValuesBy",
                label: "Sort Facet Values By",
                column: "sortFacetValuesBy",
                fieldType: "json",
                placeholder: "{\"*\": \"alpha\", \"price\": \"desc\", \"name\": \"asc\"}",
                helpText: "Configure how facet values are sorted. Each attribute maps to 'alpha' or 'count'. Example: {\"*\": \"alpha\", \"price\": \"desc\"}",
                defaultValue: "{}"
              }
            ]
          },
          { 
            name: "pagination", 
            label: "Pagination", 
            column: "pagination", 
            fieldType: "object",
            type: 'map',
            helpText: "Configure pagination settings.",
            properties: [
              {
                name: "maxTotalHits",
                label: "Max Total Hits",
                column: "maxTotalHits",
                fieldType: "number",
                helpText: "Maximum total hits for pagination.",
                defaultValue: 1000
              }
            ]
          },
          { 
            name: "proximityPrecision", 
            label: "Proximity Precision", 
            column: "proximityPrecision", 
            fieldType: "select",
            options: [
                { value: "byWord", label: "By Word" },
                { value: "byAttribute", label: "By Attribute" }
            ],
            helpText: "Configure how proximity is calculated.",
            defaultValue: "byWord"
          },
          { 
            name: "embedders", 
            label: "Embedders", 
            column: "embedders", 
            fieldType: "json",
            placeholder: "{\"default\": {\"source\": \"openAi\", \"model\": \"text-embedding-ada-002\", \"apiKey\": \"your-api-key\"}}",
            helpText: "Configure embedders for semantic search. Each embedder should have source, model, and apiKey properties.",
            defaultValue: "{}"
          },
          { 
            name: "searchCutoffMs", 
            label: "Search Cutoff (ms)", 
            column: "searchCutoffMs", 
            fieldType: "number",
            placeholder: "Enter milliseconds or leave empty for null",
            helpText: "Maximum time in milliseconds to spend on a search query. Can be null for no limit.",
            defaultValue: null
          },
          { 
            name: "localizedAttributes", 
            label: "Localized Attributes", 
            column: "localizedAttributes", 
            fieldType: "json",
            placeholder: "{\"title\": {\"fr\": \"titre\", \"en\": \"title\"}, \"description\": {\"fr\": \"description\", \"en\": \"description\"}}",
            helpText: "Configure localized attributes for multi-language support. Each attribute maps to language codes. Can be null.",
            defaultValue: null
          },
          { 
            name: "facetSearch", 
            label: "Facet Search", 
            column: "facetSearch", 
            fieldType: "boolean",
            helpText: "Enable or disable facet search functionality.",
            defaultValue: true
          },
          { 
            name: "prefixSearch", 
            label: "Prefix Search", 
            column: "prefixSearch", 
            fieldType: "select",
            options: [
                { value: "indexingTime", label: "Indexing Time" },
                { value: "searchTime", label: "Search Time" }
            ],
            helpText: "Configure when prefix search is performed.",
            defaultValue: "indexingTime"
          },

        ]
      }
    ],
    submitSuccessRedirect: "/system/search/indices/:entityName/settings-details"
  }
};