# opentelemetry-plugin-knex

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=myrotvorets_opentelemetry-plugin-knex&metric=alert_status)](https://sonarcloud.io/dashboard?id=myrotvorets_opentelemetry-plugin-knex)
![Build CI](https://github.com/myrotvorets/opentelemetry-plugin-knex/workflows/Build%20CI/badge.svg)
[![codebeat badge](https://codebeat.co/badges/94fbbee4-e589-4c17-8a0d-bed6be1dcd86)](https://codebeat.co/projects/github-com-myrotvorets-opentelemetry-plugin-knex-master)

OpenTelemetry knex automatic instrumentation package

## Usage

```typescript
import opentelemetry from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/node';
import { SimpleSpanProcessor } from '@opentelemetry/tracing';
import { ZipkinExporter } from '@opentelemetry/exporter-zipkin';

const provider = new NodeTracerProvider({
    plugins: {
        knex: {
            path: '@myrotvorets/opentelemetry-plugin-knex',
        },
        // Add other plugins as needed
        http: {},
        https: {},
    },
});

// Add exporters as needed
const zipkinExporter = new ZipkinExporter({
    url: process.env.ZIPKIN_ENDPOINT,
    serviceName: 'my-service',
});

const zipkinProcessor = new SimpleSpanProcessor(zipkinExporter);
provider.addSpanProcessor(zipkinProcessor);

// Go!
provider.register();
```
