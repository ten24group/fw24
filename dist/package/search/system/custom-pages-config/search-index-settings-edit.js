"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchIndexSettingsFormConfig = void 0;
exports.searchIndexSettingsFormConfig = {
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
        formButtons: ["submit", "reset", { text: "Cancel", url: "/system/search/indices/:entityName/settings-details" }],
        propertiesConfig: [
            {
                name: "settings",
                label: "Search Index Settings",
                column: "settings",
                fieldType: "text",
                type: 'map',
                helpText: "Configure all search index settings for this index.",
                properties: [
                    {
                        name: "displayedAttributes",
                        label: "Displayed Attributes",
                        column: "displayedAttributes",
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes to display in the search results. Use '*' for all attributes.",
                        defaultValue: ["*"]
                    },
                    {
                        name: "searchableAttributes",
                        label: "Searchable Attributes",
                        column: "searchableAttributes",
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes that the search engine can search through. Use '*' for all attributes.",
                        defaultValue: ["*"]
                    },
                    {
                        name: "filterableAttributes",
                        label: "Filterable Attributes",
                        column: "filterableAttributes",
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of attributes that can be used as filters.",
                        defaultValue: []
                    },
                    {
                        name: "sortableAttributes",
                        label: "Sortable Attributes",
                        column: "sortableAttributes",
                        fieldType: "text",
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
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of words that will be ignored by the search engine.",
                        defaultValue: []
                    },
                    {
                        name: "nonSeparatorTokens",
                        label: "Non-Separator Tokens",
                        column: "nonSeparatorTokens",
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of tokens that should not be treated as separators.",
                        defaultValue: []
                    },
                    {
                        name: "separatorTokens",
                        label: "Separator Tokens",
                        column: "separatorTokens",
                        fieldType: "text",
                        type: 'list',
                        items: { type: 'text' },
                        helpText: "List of tokens that should be treated as separators.",
                        defaultValue: []
                    },
                    {
                        name: "dictionary",
                        label: "Dictionary",
                        column: "dictionary",
                        fieldType: "text",
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
                        fieldType: "text",
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
                                fieldType: "text",
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
                                fieldType: "text",
                                type: 'list',
                                items: { type: 'text' },
                                helpText: "List of words to disable typo tolerance on.",
                                defaultValue: []
                            },
                            {
                                name: "disableOnAttributes",
                                label: "Disable On Attributes",
                                column: "disableOnAttributes",
                                fieldType: "text",
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
                        fieldType: "text",
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
                        fieldType: "text",
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VhcmNoLWluZGV4LXNldHRpbmdzLWVkaXQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvc2VhcmNoL3N5c3RlbS9jdXN0b20tcGFnZXMtY29uZmlnL3NlYXJjaC1pbmRleC1zZXR0aW5ncy1lZGl0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUVhLFFBQUEsNkJBQTZCLEdBQW1CO0lBQzNELFNBQVMsRUFBRSx1QkFBdUI7SUFDbEMsUUFBUSxFQUFFLE1BQU07SUFDaEIsWUFBWSxFQUFFLGtEQUFrRDtJQUNoRSxXQUFXLEVBQUU7UUFDWCxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRTtRQUMzQixFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGdCQUFnQixFQUFFO1FBQzFDLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLEVBQUUsd0JBQXdCLEVBQUU7UUFDbkQsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLEdBQUcsRUFBRSxvQ0FBb0MsRUFBRTtRQUNyRSxFQUFFLEtBQUssRUFBRSxrQkFBa0IsRUFBRSxHQUFHLEVBQUUscURBQXFELEVBQUU7UUFDekYsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFO0tBQzNCO0lBQ0QsY0FBYyxFQUFFO1FBQ2QsZUFBZSxFQUFFO1lBQ2YsU0FBUyxFQUFFLEtBQUs7WUFDaEIsTUFBTSxFQUFFLDZDQUE2QztTQUN0RDtRQUNELFNBQVMsRUFBRTtZQUNULFNBQVMsRUFBRSxLQUFLO1lBQ2hCLFdBQVcsRUFBRSxRQUFRO1lBQ3JCLE1BQU0sRUFBRSw2Q0FBNkM7U0FDdEQ7UUFDRCxXQUFXLEVBQUUsQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxHQUFHLEVBQUUscURBQXFELEVBQUUsQ0FBRTtRQUNsSCxnQkFBZ0IsRUFBRTtZQUNoQjtnQkFDRSxJQUFJLEVBQUUsVUFBVTtn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SSxFQUFFLHFCQUFxQjt3QkFDM0IsS0FBSyxFQUFFLHNCQUFzQjt3QkFDN0IsTUFBTSxFQUFFLHFCQUFxQjt3QkFDN0IsU0FBUyxFQUFFLE1BQU07d0JBQ2pCLFdBQVcsRUFBRSwwSEFBMEg7d0JBQ3ZJLFFBQVEsRUFBRSxnSEFBZ0g7d0JBQzFILFlBQVksRUFBRSxJQUFJO3FCQUNuQjtvQkFDRDt3QkFDRSxJQUFJLEVBQUUsYUFBYTt3QkFDbkIsS0FBSyxFQUFFLGNBQWM7d0JBQ3JCLE1BQU0sRUFBRSxhQUFhO3dCQUNyQixTQUFTLEVBQUUsU0FBUzt3QkFDcEIsUUFBUSxFQUFFLCtDQUErQzt3QkFDekQsWUFBWSxFQUFFLElBQUk7cUJBQ25CO29CQUNEO3dCQUNFLElBQUksRUFBRSxjQUFjO3dCQUNwQixLQUFLLEVBQUUsZUFBZTt3QkFDdEIsTUFBTSxFQUFFLGNBQWM7d0JBQ3RCLFNBQVMsRUFBRSxRQUFRO3dCQUNuQixPQUFPLEVBQUU7NEJBQ0wsRUFBRSxLQUFLLEVBQUUsY0FBYyxFQUFFLEtBQUssRUFBRSxlQUFlLEVBQUU7NEJBQ2pELEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsYUFBYSxFQUFFO3lCQUNoRDt3QkFDRCxRQUFRLEVBQUUsNENBQTRDO3dCQUN0RCxZQUFZLEVBQUUsY0FBYztxQkFDN0I7aUJBRUY7YUFDRjtTQUNGO1FBQ0QscUJBQXFCLEVBQUUscURBQXFEO0tBQzdFO0NBQ0YsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEZvcm1QYWdlQ29uZmlnIH0gZnJvbSBcIi4uLy4uLy4uL3VpLWNvbmZpZy1nZW5cIjtcblxuZXhwb3J0IGNvbnN0IHNlYXJjaEluZGV4U2V0dGluZ3NGb3JtQ29uZmlnOiBGb3JtUGFnZUNvbmZpZyA9IHtcbiAgcGFnZVRpdGxlOiBcIlNlYXJjaCBJbmRleCBTZXR0aW5nc1wiLFxuICBwYWdlVHlwZTogXCJmb3JtXCIsXG4gIHJvdXRlUGF0dGVybjogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWVkaXRcIixcbiAgYnJlYWRjcnVtYnM6IFtcbiAgICB7IGxhYmVsOiBcIkhvbWVcIiwgdXJsOiBcIi9cIiB9LFxuICAgIHsgbGFiZWw6IFwiU2VhcmNoXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaFwiIH0sXG4gICAgeyBsYWJlbDogXCJJbmRpY2VzXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkluZGV4IERldGFpbHNcIiwgdXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWVcIiB9LFxuICAgIHsgbGFiZWw6IFwiU2V0dGluZ3MgRGV0YWlsc1wiLCB1cmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5ncy1kZXRhaWxzXCIgfSxcbiAgICB7IGxhYmVsOiBcIkVkaXQgU2V0dGluZ3NcIiB9XG4gIF0sXG4gIGZvcm1QYWdlQ29uZmlnOiB7XG4gICAgZGV0YWlsQXBpQ29uZmlnOiB7XG4gICAgICBhcGlNZXRob2Q6IFwiR0VUXCIsXG4gICAgICBhcGlVcmw6IFwiL3N5c3RlbS9zZWFyY2gvaW5kaWNlcy86ZW50aXR5TmFtZS9zZXR0aW5nc1wiXG4gICAgfSxcbiAgICBhcGlDb25maWc6IHtcbiAgICAgIGFwaU1ldGhvZDogXCJQVVRcIixcbiAgICAgIHJlc3BvbnNlS2V5OiBcInJlc3VsdFwiLFxuICAgICAgYXBpVXJsOiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvc2V0dGluZ3NcIlxuICAgIH0sXG4gICAgZm9ybUJ1dHRvbnM6IFsgXCJzdWJtaXRcIiwgXCJyZXNldFwiLCB7IHRleHQ6IFwiQ2FuY2VsXCIsIHVybDogXCIvc3lzdGVtL3NlYXJjaC9pbmRpY2VzLzplbnRpdHlOYW1lL3NldHRpbmdzLWRldGFpbHNcIiB9IF0sXG4gICAgcHJvcGVydGllc0NvbmZpZzogW1xuICAgICAgeyBcbiAgICAgICAgbmFtZTogXCJzZXR0aW5nc1wiLCBcbiAgICAgICAgbGFiZWw6IFwiU2VhcmNoIEluZGV4IFNldHRpbmdzXCIsIFxuICAgICAgICBjb2x1bW46IFwic2V0dGluZ3NcIiwgXG4gICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgYWxsIHNlYXJjaCBpbmRleCBzZXR0aW5ncyBmb3IgdGhpcyBpbmRleC5cIixcbiAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImRpc3BsYXllZEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJEaXNwbGF5ZWQgQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJkaXNwbGF5ZWRBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiBhdHRyaWJ1dGVzIHRvIGRpc3BsYXkgaW4gdGhlIHNlYXJjaCByZXN1bHRzLiBVc2UgJyonIGZvciBhbGwgYXR0cmlidXRlcy5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogW1wiKlwiXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwic2VhcmNoYWJsZUF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJTZWFyY2hhYmxlIEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwic2VhcmNoYWJsZUF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIGF0dHJpYnV0ZXMgdGhhdCB0aGUgc2VhcmNoIGVuZ2luZSBjYW4gc2VhcmNoIHRocm91Z2guIFVzZSAnKicgZm9yIGFsbCBhdHRyaWJ1dGVzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXCIqXCJdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJmaWx0ZXJhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIkZpbHRlcmFibGUgQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJmaWx0ZXJhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkxpc3Qgb2YgYXR0cmlidXRlcyB0aGF0IGNhbiBiZSB1c2VkIGFzIGZpbHRlcnMuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJzb3J0YWJsZUF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJTb3J0YWJsZSBBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInNvcnRhYmxlQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkxpc3Qgb2YgYXR0cmlidXRlcyB0aGF0IGNhbiBiZSB1c2VkIGZvciBzb3J0aW5nIHNlYXJjaCByZXN1bHRzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwicmFua2luZ1J1bGVzXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiUmFua2luZyBSdWxlc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJyYW5raW5nUnVsZXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwibXVsdGktc2VsZWN0XCIsXG4gICAgICAgICAgICBvcHRpb25zOiBbXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJ3b3Jkc1wiLCBsYWJlbDogXCJXb3Jkc1wiIH0sXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJ0eXBvXCIsIGxhYmVsOiBcIlR5cG9cIiB9LFxuICAgICAgICAgICAgICAgIHsgdmFsdWU6IFwicHJveGltaXR5XCIsIGxhYmVsOiBcIlByb3hpbWl0eVwiIH0sXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJhdHRyaWJ1dGVcIiwgbGFiZWw6IFwiQXR0cmlidXRlXCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcInNvcnRcIiwgbGFiZWw6IFwiU29ydFwiIH0sXG4gICAgICAgICAgICAgICAgeyB2YWx1ZTogXCJleGFjdG5lc3NcIiwgbGFiZWw6IFwiRXhhY3RuZXNzXCIgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIlRoZSBvcmRlciBvZiByYW5raW5nIHJ1bGVzIGZvciBzZWFyY2ggcmVzdWx0cy4gT3JkZXIgbWF0dGVycy5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogW1wid29yZHNcIiwgXCJ0eXBvXCIsIFwicHJveGltaXR5XCIsIFwiYXR0cmlidXRlXCIsIFwic29ydFwiLCBcImV4YWN0bmVzc1wiXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwic3RvcFdvcmRzXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiU3RvcCBXb3Jkc1wiLCBcbiAgICAgICAgICAgIGNvbHVtbjogXCJzdG9wV29yZHNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgdHlwZTogJ2xpc3QnLFxuICAgICAgICAgICAgaXRlbXM6IHsgdHlwZTogJ3RleHQnIH0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIHdvcmRzIHRoYXQgd2lsbCBiZSBpZ25vcmVkIGJ5IHRoZSBzZWFyY2ggZW5naW5lLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwibm9uU2VwYXJhdG9yVG9rZW5zXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiTm9uLVNlcGFyYXRvciBUb2tlbnNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwibm9uU2VwYXJhdG9yVG9rZW5zXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiB0b2tlbnMgdGhhdCBzaG91bGQgbm90IGJlIHRyZWF0ZWQgYXMgc2VwYXJhdG9ycy5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogW11cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcInNlcGFyYXRvclRva2Vuc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlNlcGFyYXRvciBUb2tlbnNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwic2VwYXJhdG9yVG9rZW5zXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgIGl0ZW1zOiB7IHR5cGU6ICd0ZXh0JyB9LFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiTGlzdCBvZiB0b2tlbnMgdGhhdCBzaG91bGQgYmUgdHJlYXRlZCBhcyBzZXBhcmF0b3JzLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwiZGljdGlvbmFyeVwiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIkRpY3Rpb25hcnlcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZGljdGlvbmFyeVwiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbGlzdCcsXG4gICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkxpc3Qgb2Ygd29yZHMgdG8gYmUgYWRkZWQgdG8gdGhlIGRpY3Rpb25hcnkuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJzeW5vbnltc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlN5bm9ueW1zXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInN5bm9ueW1zXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIntcXFwid29sdmVyaW5lXFxcIjogW1xcXCJ4bWVuXFxcIiwgXFxcImxvZ2FuXFxcIl0sIFxcXCJsb2dhblxcXCI6IFtcXFwid29sdmVyaW5lXFxcIiwgXFxcInhtZW5cXFwiXX1cIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkRlZmluZSBzZXRzIG9mIHdvcmRzIHRoYXQgc2hvdWxkIGJlIGNvbnNpZGVyZWQgZXF1aXZhbGVudC4gRWFjaCBrZXkgc2hvdWxkIG1hcCB0byBhbiBhcnJheSBvZiBzdHJpbmdzLiBFeGFtcGxlOiB7XFxcIndvbHZlcmluZVxcXCI6IFtcXFwieG1lblxcXCIsIFxcXCJsb2dhblxcXCJdfVwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBcInt9XCJcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImRpc3RpbmN0QXR0cmlidXRlXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRGlzdGluY3QgQXR0cmlidXRlXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImRpc3RpbmN0QXR0cmlidXRlXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcInRleHRcIixcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIkVudGVyIGF0dHJpYnV0ZSBuYW1lIG9yIGxlYXZlIGVtcHR5IGZvciBudWxsXCIsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJBbiBhdHRyaWJ1dGUgdG8gZW5zdXJlIHRoZXJlIGFyZSBubyBkdXBsaWNhdGUgZG9jdW1lbnRzIGluIHRoZSByZXN1bHRzLiBDYW4gYmUgbnVsbC5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwidHlwb1RvbGVyYW5jZVwiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlR5cG8gVG9sZXJhbmNlXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInR5cG9Ub2xlcmFuY2VcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgdGhlIHRvbGVyYW5jZSBmb3IgdHlwb3MgaW4gc2VhcmNoIHF1ZXJpZXMuXCIsXG4gICAgICAgICAgICBwcm9wZXJ0aWVzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiBcImVuYWJsZWRcIixcbiAgICAgICAgICAgICAgICBsYWJlbDogXCJFbmFibGVkXCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcImVuYWJsZWRcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkVuYWJsZSBvciBkaXNhYmxlIHR5cG8gdG9sZXJhbmNlLlwiLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogdHJ1ZVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJtaW5Xb3JkU2l6ZUZvclR5cG9zXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiTWluaW11bSBXb3JkIFNpemUgZm9yIFR5cG9zXCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcIm1pbldvcmRTaXplRm9yVHlwb3NcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdtYXAnLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBtaW5pbXVtIHdvcmQgc2l6ZSBmb3IgdHlwbyB0b2xlcmFuY2UuXCIsXG4gICAgICAgICAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBuYW1lOiBcIm9uZVR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgbGFiZWw6IFwiT25lIFR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcIm9uZVR5cG9cIixcbiAgICAgICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJNaW5pbXVtIHdvcmQgc2l6ZSBmb3Igb25lIHR5cG8uXCIsXG4gICAgICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogNVxuICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbmFtZTogXCJ0d29UeXBvc1wiLFxuICAgICAgICAgICAgICAgICAgICBsYWJlbDogXCJUd28gVHlwb3NcIixcbiAgICAgICAgICAgICAgICAgICAgY29sdW1uOiBcInR3b1R5cG9zXCIsXG4gICAgICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJudW1iZXJcIixcbiAgICAgICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiTWluaW11bSB3b3JkIHNpemUgZm9yIHR3byB0eXBvcy5cIixcbiAgICAgICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiA5XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJkaXNhYmxlT25Xb3Jkc1wiLFxuICAgICAgICAgICAgICAgIGxhYmVsOiBcIkRpc2FibGUgT24gV29yZHNcIixcbiAgICAgICAgICAgICAgICBjb2x1bW46IFwiZGlzYWJsZU9uV29yZHNcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIHdvcmRzIHRvIGRpc2FibGUgdHlwbyB0b2xlcmFuY2Ugb24uXCIsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBbXVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJkaXNhYmxlT25BdHRyaWJ1dGVzXCIsXG4gICAgICAgICAgICAgICAgbGFiZWw6IFwiRGlzYWJsZSBPbiBBdHRyaWJ1dGVzXCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcImRpc2FibGVPbkF0dHJpYnV0ZXNcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdsaXN0JyxcbiAgICAgICAgICAgICAgICBpdGVtczogeyB0eXBlOiAndGV4dCcgfSxcbiAgICAgICAgICAgICAgICBoZWxwVGV4dDogXCJMaXN0IG9mIGF0dHJpYnV0ZXMgdG8gZGlzYWJsZSB0eXBvIHRvbGVyYW5jZSBvbi5cIixcbiAgICAgICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFtdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcImZhY2V0aW5nXCIsIFxuICAgICAgICAgICAgbGFiZWw6IFwiRmFjZXRpbmdcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZmFjZXRpbmdcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwidGV4dFwiLFxuICAgICAgICAgICAgdHlwZTogJ21hcCcsXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgc2V0dGluZ3MgZm9yIGZhY2V0ZWQgc2VhcmNoLlwiLFxuICAgICAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJtYXhWYWx1ZXNQZXJGYWNldFwiLFxuICAgICAgICAgICAgICAgIGxhYmVsOiBcIk1heCBWYWx1ZXMgUGVyIEZhY2V0XCIsXG4gICAgICAgICAgICAgICAgY29sdW1uOiBcIm1heFZhbHVlc1BlckZhY2V0XCIsXG4gICAgICAgICAgICAgICAgZmllbGRUeXBlOiBcIm51bWJlclwiLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIk1heGltdW0gbnVtYmVyIG9mIHZhbHVlcyBwZXIgZmFjZXQuXCIsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiAxMDBcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6IFwic29ydEZhY2V0VmFsdWVzQnlcIixcbiAgICAgICAgICAgICAgICBsYWJlbDogXCJTb3J0IEZhY2V0IFZhbHVlcyBCeVwiLFxuICAgICAgICAgICAgICAgIGNvbHVtbjogXCJzb3J0RmFjZXRWYWx1ZXNCeVwiLFxuICAgICAgICAgICAgICAgIGZpZWxkVHlwZTogXCJqc29uXCIsXG4gICAgICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwie1xcXCIqXFxcIjogXFxcImFscGhhXFxcIiwgXFxcInByaWNlXFxcIjogXFxcImRlc2NcXFwiLCBcXFwibmFtZVxcXCI6IFxcXCJhc2NcXFwifVwiLFxuICAgICAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBob3cgZmFjZXQgdmFsdWVzIGFyZSBzb3J0ZWQuIEVhY2ggYXR0cmlidXRlIG1hcHMgdG8gJ2FscGhhJyBvciAnY291bnQnLiBFeGFtcGxlOiB7XFxcIipcXFwiOiBcXFwiYWxwaGFcXFwiLCBcXFwicHJpY2VcXFwiOiBcXFwiZGVzY1xcXCJ9XCIsXG4gICAgICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBcInt9XCJcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwicGFnaW5hdGlvblwiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlBhZ2luYXRpb25cIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwicGFnaW5hdGlvblwiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJ0ZXh0XCIsXG4gICAgICAgICAgICB0eXBlOiAnbWFwJyxcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBwYWdpbmF0aW9uIHNldHRpbmdzLlwiLFxuICAgICAgICAgICAgcHJvcGVydGllczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogXCJtYXhUb3RhbEhpdHNcIixcbiAgICAgICAgICAgICAgICBsYWJlbDogXCJNYXggVG90YWwgSGl0c1wiLFxuICAgICAgICAgICAgICAgIGNvbHVtbjogXCJtYXhUb3RhbEhpdHNcIixcbiAgICAgICAgICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICAgICAgaGVscFRleHQ6IFwiTWF4aW11bSB0b3RhbCBoaXRzIGZvciBwYWdpbmF0aW9uLlwiLFxuICAgICAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogMTAwMFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJwcm94aW1pdHlQcmVjaXNpb25cIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJQcm94aW1pdHkgUHJlY2lzaW9uXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcInByb3hpbWl0eVByZWNpc2lvblwiLCBcbiAgICAgICAgICAgIGZpZWxkVHlwZTogXCJzZWxlY3RcIixcbiAgICAgICAgICAgIG9wdGlvbnM6IFtcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcImJ5V29yZFwiLCBsYWJlbDogXCJCeSBXb3JkXCIgfSxcbiAgICAgICAgICAgICAgICB7IHZhbHVlOiBcImJ5QXR0cmlidXRlXCIsIGxhYmVsOiBcIkJ5IEF0dHJpYnV0ZVwiIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgaG93IHByb3hpbWl0eSBpcyBjYWxjdWxhdGVkLlwiLFxuICAgICAgICAgICAgZGVmYXVsdFZhbHVlOiBcImJ5V29yZFwiXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7IFxuICAgICAgICAgICAgbmFtZTogXCJlbWJlZGRlcnNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJFbWJlZGRlcnNcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZW1iZWRkZXJzXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcImpzb25cIixcbiAgICAgICAgICAgIHBsYWNlaG9sZGVyOiBcIntcXFwiZGVmYXVsdFxcXCI6IHtcXFwic291cmNlXFxcIjogXFxcIm9wZW5BaVxcXCIsIFxcXCJtb2RlbFxcXCI6IFxcXCJ0ZXh0LWVtYmVkZGluZy1hZGEtMDAyXFxcIiwgXFxcImFwaUtleVxcXCI6IFxcXCJ5b3VyLWFwaS1rZXlcXFwifX1cIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIkNvbmZpZ3VyZSBlbWJlZGRlcnMgZm9yIHNlbWFudGljIHNlYXJjaC4gRWFjaCBlbWJlZGRlciBzaG91bGQgaGF2ZSBzb3VyY2UsIG1vZGVsLCBhbmQgYXBpS2V5IHByb3BlcnRpZXMuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IFwie31cIlxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwic2VhcmNoQ3V0b2ZmTXNcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJTZWFyY2ggQ3V0b2ZmIChtcylcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwic2VhcmNoQ3V0b2ZmTXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwibnVtYmVyXCIsXG4gICAgICAgICAgICBwbGFjZWhvbGRlcjogXCJFbnRlciBtaWxsaXNlY29uZHMgb3IgbGVhdmUgZW1wdHkgZm9yIG51bGxcIixcbiAgICAgICAgICAgIGhlbHBUZXh0OiBcIk1heGltdW0gdGltZSBpbiBtaWxsaXNlY29uZHMgdG8gc3BlbmQgb24gYSBzZWFyY2ggcXVlcnkuIENhbiBiZSBudWxsIGZvciBubyBsaW1pdC5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwibG9jYWxpemVkQXR0cmlidXRlc1wiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIkxvY2FsaXplZCBBdHRyaWJ1dGVzXCIsIFxuICAgICAgICAgICAgY29sdW1uOiBcImxvY2FsaXplZEF0dHJpYnV0ZXNcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwianNvblwiLFxuICAgICAgICAgICAgcGxhY2Vob2xkZXI6IFwie1xcXCJ0aXRsZVxcXCI6IHtcXFwiZnJcXFwiOiBcXFwidGl0cmVcXFwiLCBcXFwiZW5cXFwiOiBcXFwidGl0bGVcXFwifSwgXFxcImRlc2NyaXB0aW9uXFxcIjoge1xcXCJmclxcXCI6IFxcXCJkZXNjcmlwdGlvblxcXCIsIFxcXCJlblxcXCI6IFxcXCJkZXNjcmlwdGlvblxcXCJ9fVwiLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiQ29uZmlndXJlIGxvY2FsaXplZCBhdHRyaWJ1dGVzIGZvciBtdWx0aS1sYW5ndWFnZSBzdXBwb3J0LiBFYWNoIGF0dHJpYnV0ZSBtYXBzIHRvIGxhbmd1YWdlIGNvZGVzLiBDYW4gYmUgbnVsbC5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogbnVsbFxuICAgICAgICAgIH0sXG4gICAgICAgICAgeyBcbiAgICAgICAgICAgIG5hbWU6IFwiZmFjZXRTZWFyY2hcIiwgXG4gICAgICAgICAgICBsYWJlbDogXCJGYWNldCBTZWFyY2hcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwiZmFjZXRTZWFyY2hcIiwgXG4gICAgICAgICAgICBmaWVsZFR5cGU6IFwiYm9vbGVhblwiLFxuICAgICAgICAgICAgaGVscFRleHQ6IFwiRW5hYmxlIG9yIGRpc2FibGUgZmFjZXQgc2VhcmNoIGZ1bmN0aW9uYWxpdHkuXCIsXG4gICAgICAgICAgICBkZWZhdWx0VmFsdWU6IHRydWVcbiAgICAgICAgICB9LFxuICAgICAgICAgIHsgXG4gICAgICAgICAgICBuYW1lOiBcInByZWZpeFNlYXJjaFwiLCBcbiAgICAgICAgICAgIGxhYmVsOiBcIlByZWZpeCBTZWFyY2hcIiwgXG4gICAgICAgICAgICBjb2x1bW46IFwicHJlZml4U2VhcmNoXCIsIFxuICAgICAgICAgICAgZmllbGRUeXBlOiBcInNlbGVjdFwiLFxuICAgICAgICAgICAgb3B0aW9uczogW1xuICAgICAgICAgICAgICAgIHsgdmFsdWU6IFwiaW5kZXhpbmdUaW1lXCIsIGxhYmVsOiBcIkluZGV4aW5nIFRpbWVcIiB9LFxuICAgICAgICAgICAgICAgIHsgdmFsdWU6IFwic2VhcmNoVGltZVwiLCBsYWJlbDogXCJTZWFyY2ggVGltZVwiIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBoZWxwVGV4dDogXCJDb25maWd1cmUgd2hlbiBwcmVmaXggc2VhcmNoIGlzIHBlcmZvcm1lZC5cIixcbiAgICAgICAgICAgIGRlZmF1bHRWYWx1ZTogXCJpbmRleGluZ1RpbWVcIlxuICAgICAgICAgIH0sXG5cbiAgICAgICAgXVxuICAgICAgfVxuICAgIF0sXG4gICAgc3VibWl0U3VjY2Vzc1JlZGlyZWN0OiBcIi9zeXN0ZW0vc2VhcmNoL2luZGljZXMvOmVudGl0eU5hbWUvc2V0dGluZ3MtZGV0YWlsc1wiXG4gIH1cbn07Il19