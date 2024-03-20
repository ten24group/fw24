/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // testMatch: ['./src/**/*.test.ts'],

  testMatch: [
      "<rootDir>/src/**/*.(test).{js,jsx,ts,tsx}",
      "<rootDir>/src/**/?(*.)(spec|test).{js,jsx,ts,tsx}"
  ],
};