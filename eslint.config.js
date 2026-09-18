import baseConfig from '@hono/eslint-config';

export default [
  {
    ignores: ['dist/**', 'eslint.config.js'],
  },
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
