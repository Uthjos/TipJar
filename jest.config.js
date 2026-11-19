/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Pure TypeScript engine / logic tests — no React Native runtime needed.
      displayName: 'engine',
      preset: 'jest-expo',
      testEnvironment: 'node',
      testMatch: ['**/src/**/__tests__/**/*.test.ts'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
    {
      // Component / screen tests.
      displayName: 'ui',
      preset: 'jest-expo',
      testMatch: ['**/src/**/__tests__/**/*.test.tsx', '**/app/**/__tests__/**/*.test.tsx'],
      moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
    },
  ],
};
