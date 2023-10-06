import { NodeSDK } from '@opentelemetry/sdk-node';
import { KnexInstrumentation } from '@myrotvorets/opentelemetry-plugin-knex';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const sdk = new NodeSDK({
    serviceName: 'example',
    instrumentations: [new HttpInstrumentation(), new KnexInstrumentation()],
});

sdk.start();
