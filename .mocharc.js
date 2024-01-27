'use strict';

module.exports = {
    recursive: true,
    extension: ['.spec.ts'],
    'node-option': ['loader=ts-node/esm', 'no-warnings'],
    require: ['chai/register-expect.js', 'ts-node/register'],
    reporter: 'mocha-multi',
    'reporter-option': [
        'spec=-',
        process.env.GITHUB_ACTIONS === 'true' ? 'mocha-reporter-gha=-' : null,
        process.env.SONARSCANNER === 'true' ? 'mocha-reporter-sonarqube=test-report.xml' : null,
    ].filter(Boolean),
};
