# opentelemetry-plugin-knex

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
