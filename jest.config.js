/** @type {import('ts-jest').JestConfigWithTsJest} */

const { env } = require('process');
process.env.POWERTOOLS_DEV = 'true'; // for observability logs during testing


module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: 2,
  detectOpenHandles: true,
  // testMatch: ['./src/**/*.test.ts'],
    globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.json',
    },
  },

  testMatch: [
      "<rootDir>/src/**/*.(test).{js,jsx,ts,tsx}",
      "<rootDir>/src/**/?(*.)(spec|test).{js,jsx,ts,tsx}"
  ],

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      // PERFORMANCE: Disable type checking in tests (use tsc separately)
      isolatedModules: true,
    }],
    // Transform JS files from ES modules packages
    '^.+\\.js$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      isolatedModules: true,
    }]
  },
  
  // Allow transformation of ES modules from node_modules (e.g., uuid)
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)'
  ]
};