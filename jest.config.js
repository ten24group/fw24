/** @type {import('ts-jest').JestConfigWithTsJest} */
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
};