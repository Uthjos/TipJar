// Agent worktrees under .claude/ contain their own copies of the repo; keep Jest out of them.
const shared = {
  preset: 'jest-expo',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
};

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      // Pure TypeScript engine / logic tests — no React Native runtime needed.
      ...shared,
      displayName: 'engine',
      testEnvironment: 'node',
      testMatch: ['**/src/**/__tests__/**/*.test.ts'],
    },
    {
      // Component / screen tests.
      ...shared,
      displayName: 'ui',
      testMatch: ['**/src/**/__tests__/**/*.test.tsx'],
    },
  ],
};
