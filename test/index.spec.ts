/* eslint-disable sonarjs/no-nested-functions */
import { equal, notEqual } from 'node:assert/strict';
import { SpanStatusCode, type TracerProvider, context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    type ReadableSpan,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Knex, knex } from 'knex';
import { ATTR_DB_NAMESPACE, ATTR_DB_QUERY_TEXT, ATTR_DB_SYSTEM_NAME } from '@opentelemetry/semantic-conventions';
import { KnexInstrumentation } from '../lib';

function checkSpanAttributes(
    spans: readonly ReadableSpan[],
    name: string,
    code: SpanStatusCode,
    stmt: string,
    err?: Error & { code?: string },
): void {
    equal(spans[0]!.name.length > 0, true);
    equal(spans[0]!.name, name);
    equal(spans[0]!.status.code, code);
    equal(spans[0]!.attributes[ATTR_DB_SYSTEM_NAME], 'sqlite3');
    equal(spans[0]!.attributes[ATTR_DB_NAMESPACE], ':memory:');
    equal(spans[0]!.attributes[ATTR_DB_QUERY_TEXT], stmt);
    if (err) {
        equal(Array.isArray(spans[0]!.events), true);
        equal(spans[0]!.events.length, 1);
        notEqual(spans[0]!.events[0]!.attributes, undefined);
        equal(spans[0]!.events[0]!.attributes!['exception.type'], err.code ?? err.name);
        equal(spans[0]!.events[0]!.attributes!['exception.message'], err.message);
    }
}

describe('KnexPlugin', function () {
    let plugin: KnexInstrumentation;
    let connection: Knex;

    let contextManager: AsyncHooksContextManager;
    let memoryExporter: InMemorySpanExporter;
    let provider: TracerProvider;

    before(function () {
        plugin = new KnexInstrumentation({ enabled: false });
        memoryExporter = new InMemorySpanExporter();
        provider = new BasicTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(memoryExporter)],
        });
        plugin.setTracerProvider(provider);
    });

    beforeEach(function () {
        contextManager = new AsyncHooksContextManager().enable();
        context.setGlobalContextManager(contextManager);
        plugin.enable();

        connection = knex({
            client: 'sqlite',
            connection: {
                filename: ':memory:',
            },
            useNullAsDefault: true,
        });
    });

    afterEach(function () {
        context.disable();
        memoryExporter.reset();
        plugin.disable();
        return connection.destroy();
    });

    it('should export a plugin', function () {
        equal(plugin instanceof KnexInstrumentation, true);
    });

    it('should have correct instrumentationName', function () {
        equal(plugin.instrumentationName, '@myrotvorets/opentelemetry-plugin-knex');
    });

    it('should handle double enable() gracefully', function () {
        return new Promise<void>((resolve, reject) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                plugin.enable();
                connection
                    .select(connection.raw('2+2'))
                    .finally(() => {
                        const spans = memoryExporter.getFinishedSpans();
                        equal(Array.isArray(spans), true);
                        equal(spans.length, 1);
                        resolve();
                    })
                    .catch(reject);
            });
        });
    });

    it('should handle double disable() gracefully', function () {
        return new Promise<void>((resolve, reject) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                plugin.disable();
                plugin.disable();

                connection
                    .select(connection.raw('2+2'))
                    .finally(() => {
                        const spans = memoryExporter.getFinishedSpans();
                        equal(Array.isArray(spans), true);
                        equal(spans.length, 0);
                        resolve();
                    })
                    .catch(reject);
            });
        });
    });

    it('should name the span accordingly', function () {
        return new Promise<void>((resolve, reject) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                connection
                    .select(connection.raw('2+2'))
                    .finally(() => {
                        const spans = memoryExporter.getFinishedSpans();
                        equal(Array.isArray(spans), true);
                        equal(spans.length, 1);
                        checkSpanAttributes(spans, 'select', SpanStatusCode.OK, 'select 2+2');
                        resolve();
                    })
                    .catch(reject);
            });
        });
    });

    it('should add bindings to DB_STATEMENT', function () {
        return new Promise<void>((resolve, reject) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                connection
                    .select(connection.raw('?', 2))
                    .finally(() => {
                        const spans = memoryExporter.getFinishedSpans();
                        checkSpanAttributes(spans, 'select', SpanStatusCode.OK, 'select ?\nwith [2]');
                        resolve();
                    })
                    .catch(reject);
            });
        });
    });

    it('should attach error messages to spans', function () {
        return new Promise<void>((resolve, reject) => {
            const span = provider.getTracer('default').startSpan('test span');
            context.with(trace.setSpan(context.active(), span), () => {
                connection
                    .raw('SLECT 2+2')
                    .catch((e: unknown) => {
                        const spans = memoryExporter.getFinishedSpans();
                        equal(Array.isArray(spans), true);
                        equal(spans.length, 1);
                        checkSpanAttributes(spans, 'raw', SpanStatusCode.ERROR, 'SLECT 2+2', e as Error);
                        resolve();
                    })
                    .catch(reject);
            });
        });
    });

    // See https://github.com/wdalmut/opentelemetry-plugin-mongoose/pull/34/files
    it('should handle await on a thenable query object (raw)', function () {
        const rootSpan = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), rootSpan), async () => {
            await connection.raw('SELECT 2+2');

            const spans = memoryExporter.getFinishedSpans();
            equal(Array.isArray(spans), true);
            equal(spans.length, 1);
            checkSpanAttributes(spans, 'raw', SpanStatusCode.OK, 'SELECT 2+2');

            equal(spans[0]!.spanContext().traceId, rootSpan.spanContext().traceId);
            equal(spans[0]!.parentSpanId, rootSpan.spanContext().spanId);
        });
    });

    it('should handle await on a thenable query object (query builder)', function () {
        const rootSpan = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), rootSpan), async () => {
            await connection.select(connection.raw('2+2'));

            const spans = memoryExporter.getFinishedSpans();
            equal(Array.isArray(spans), true);
            equal(spans.length, 1);
            checkSpanAttributes(spans, 'select', SpanStatusCode.OK, 'select 2+2');

            equal(spans[0]!.spanContext().traceId, rootSpan.spanContext().traceId);
            equal(spans[0]!.parentSpanId, rootSpan.spanContext().spanId);
        });
    });

    it('should handle Promise.all', function () {
        const span = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), span), async () => {
            return Promise.all([
                await connection.select(connection.raw('2+2')),
                await connection.select(connection.raw('3+3')),
            ]).then(() => {
                span.end();

                const spans = memoryExporter.getFinishedSpans();
                equal(Array.isArray(spans), true);
                equal(spans.length, 3);
                equal([...new Set(spans.map((currentSpan) => currentSpan.spanContext().traceId))].length, 1);
                return true;
            });
        });
    });

    it('should handle a combined operation with async/await', function () {
        const span = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), span), async () => {
            await connection.select(connection.raw('2+2'));
            span.end();

            const spans = memoryExporter.getFinishedSpans();
            equal(Array.isArray(spans), true);
            equal(spans.length, 2);
            equal([...new Set(spans.map((currentSpan) => currentSpan.spanContext().traceId))].length, 1);
        });
    });

    it('should handle transactions', function () {
        const span = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), span), async () => {
            await connection.transaction((trx) => {
                return trx.raw('SELECT 2+2');
            });

            const spans = memoryExporter.getFinishedSpans();
            equal(Array.isArray(spans), true);
            equal(spans.length, 3);
            equal(spans[1]!.name, 'raw');
        });
    });
});
