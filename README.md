# opentelemetry-plugin-knex

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=myrotvorets_opentelemetry-plugin-knex&metric=alert_status)](https://sonarcloud.io/dashboard?id=myrotvorets_opentelemetry-plugin-knex)
[![Build and Test](https://github.com/myrotvorets/opentelemetry-plugin-knex/actions/workflows/build.yml/badge.svg)](https://github.com/myrotvorets/opentelemetry-plugin-knex/actions/workflows/build.yml)

OpenTelemetry knex automatic instrumentation package

## Usage

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { KnexInstrumentation } from '@myrotvorets/opentelemetry-plugin-knex';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const sdk = new NodeSDK({
    serviceName: 'example',
    instrumentations: [new HttpInstrumentation(), new KnexInstrumentation()],
});

sdk.start();
```

See the [`example`](example) directory for a working example.
