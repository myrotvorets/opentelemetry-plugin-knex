import MyrotvoretsConfig from '@myrotvorets/eslint-config-myrotvorets-ts';
import MochaPlugin from 'eslint-plugin-mocha';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
    {
        ignores: ['dist/**', 'example/**'],
    },
    ...MyrotvoretsConfig,
    MochaPlugin.configs.flat.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
];
