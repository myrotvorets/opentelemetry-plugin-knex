import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { SEMATTRS_DB_NAME, SEMATTRS_DB_STATEMENT, SEMATTRS_DB_SYSTEM } from '@opentelemetry/semantic-conventions';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    ReadableSpan,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { Knex, knex } from 'knex';
import { KnexInstrumentation } from '../lib';

declare global {
    const expect: typeof chai.expect;
}

function checkSpanAttributes(
    spans: Readonly<ReadableSpan[]>,
    name: string,
    code: SpanStatusCode,
    stmt: string,
    err?: Error & { code?: string },
): void {
    expect(spans[0]!.name).to.have.length.above(0);
    expect(spans[0]!.name).to.equal(name);
    expect(spans[0]!.status.code).to.equal(code);
    expect(spans[0]!.attributes[SEMATTRS_DB_SYSTEM]).to.equal('sqlite3');
    expect(spans[0]!.attributes[SEMATTRS_DB_NAME]).to.equal(':memory:');
    expect(spans[0]!.attributes[SEMATTRS_DB_STATEMENT]).to.equal(stmt);
    if (err) {
        expect(spans[0]!.events).to.be.an('array').and.have.length(1);
        expect(spans[0]!.events[0]!.attributes)
            .to.be.an('object')
            .that.includes({
                'exception.type': err.code ?? err.name,
                'exception.message': err.message,
            });
    }
}

describe('KnexPlugin', () => {
    const plugin = new KnexInstrumentation({ enabled: false });
    let connection: Knex;

    let contextManager: AsyncHooksContextManager;
    const provider = new BasicTracerProvider();
    plugin.setTracerProvider(provider);
    const memoryExporter = new InMemorySpanExporter();
    provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));

    beforeEach(() => {
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

    afterEach(() => {
        context.disable();
        memoryExporter.reset();
        plugin.disable();
        return connection.destroy();
    });

    it('should export a plugin', () => {
        expect(plugin).to.be.instanceOf(KnexInstrumentation);
    });

    it('should have correct instrumentationName', () => {
        expect(plugin.instrumentationName).to.equal('@myrotvorets/opentelemetry-plugin-knex');
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
                        expect(spans).to.be.an('array').and.have.length(1);
                        resolve();
                    })
                    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
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
                        expect(spans).to.have.length(0);
                        resolve();
                    })
                    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
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
                        expect(spans).to.have.length(1);
                        checkSpanAttributes(spans, 'select', SpanStatusCode.OK, 'select 2+2');
                        resolve();
                    })
                    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
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
                    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
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
                        expect(spans).to.have.length(1);
                        checkSpanAttributes(spans, 'raw', SpanStatusCode.ERROR, 'SLECT 2+2', e as Error);
                        resolve();
                    })
                    // eslint-disable-next-line @typescript-eslint/use-unknown-in-catch-callback-variable
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
            expect(spans).to.have.length(1);
            checkSpanAttributes(spans, 'raw', SpanStatusCode.OK, 'SELECT 2+2');

            expect(spans[0]!.spanContext().traceId).to.equal(rootSpan.spanContext().traceId);
            expect(spans[0]!.parentSpanId).to.equal(rootSpan.spanContext().spanId);
        });
    });

    it('should handle await on a thenable query object (query builder)', function () {
        const rootSpan = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), rootSpan), async () => {
            await connection.select(connection.raw('2+2'));

            const spans = memoryExporter.getFinishedSpans();
            expect(spans).to.have.length(1);
            checkSpanAttributes(spans, 'select', SpanStatusCode.OK, 'select 2+2');

            expect(spans[0]!.spanContext().traceId).to.equal(rootSpan.spanContext().traceId);
            expect(spans[0]!.parentSpanId).to.equal(rootSpan.spanContext().spanId);
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
                expect(spans).to.have.length(3);
                expect([...new Set(spans.map((currentSpan) => currentSpan.spanContext().traceId))]).to.have.length(1);
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
            expect(spans).to.have.length(2);
            expect([...new Set(spans.map((currentSpan) => currentSpan.spanContext().traceId))]).to.have.length(1);
        });
    });

    it('should handle transactions', function () {
        const span = provider.getTracer('default').startSpan('test span');
        return context.with(trace.setSpan(context.active(), span), async () => {
            await connection.transaction((trx) => {
                return trx.raw('SELECT 2+2');
            });

            const spans = memoryExporter.getFinishedSpans();
            expect(spans).to.have.length(3);
            expect(spans[1]!.name).to.equal('raw');
        });
    });
});
