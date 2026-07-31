module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@engine/(.*)$': '<rootDir>/src/engine/$1',
    '^@data/(.*)$': '<rootDir>/src/data/$1',
    '^@tools/(.*)$': '<rootDir>/src/tools/$1',
    '^@operations/(.*)$': '<rootDir>/src/operations/$1',
    '^@file/(.*)$': '<rootDir>/src/file/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        lib: ['ES2022', 'DOM'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        sourceMap: true,
        baseUrl: '.',
        types: ['jest'],
      },
    }],
  },
};
