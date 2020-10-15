import { CanonicalCode, context } from '@opentelemetry/api';
import { NoopLogger } from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/node';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/tracing';
import knex from 'knex';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import { KnexPlugin, plugin } from '../lib';

describe('KnexPlugin', () => {
    let contextManager: AsyncHooksContextManager;
    let connection: knex;
    const provider = new NodeTracerProvider({ plugins: {} });
    const logger = new NoopLogger();
    const memoryExporter = new InMemorySpanExporter();

    beforeAll(() => {
        provider.addSpanProcessor(new SimpleSpanProcessor(memoryExporter));
    });

    afterAll((done) => {
        connection
            .destroy()
            .then(() => {
                done();
            })
            .catch((e) => {
                done.fail(e);
            });
    });

    beforeEach(() => {
        contextManager = new AsyncHooksContextManager().enable();
        context.setGlobalContextManager(contextManager);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        plugin.enable(knex as any, provider, logger);

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
    });

    it('should export a plugin', () => {
        expect(plugin).toBeInstanceOf(KnexPlugin);
    });

    it('should have correct moduleName', () => {
        expect(plugin.moduleName).toBe('knex');
    });

    it('should name the span accordingly ', (done) => {
        const span = provider.getTracer('default').startSpan('test span');
        provider.getTracer('default').withSpan(span, () => {
            connection.select(connection.raw('2+2')).finally(() => {
                const spans = memoryExporter.getFinishedSpans();
                expect(spans[0].name).toBe('select');
                expect(spans[0].status.code).toBe(CanonicalCode.OK);
                expect(spans[0].attributes[DatabaseAttribute.DB_SYSTEM]).toBe('sqlite');
                expect(spans[0].attributes[DatabaseAttribute.DB_NAME]).toBe(':memory:');
                expect(spans[0].attributes[DatabaseAttribute.DB_STATEMENT]).toBe('select 2+2');
                done();
            });
        });
    });

    it('should add bindings to DB_STATEMENT ', (done) => {
        const span = provider.getTracer('default').startSpan('test span');
        provider.getTracer('default').withSpan(span, () => {
            connection.select(connection.raw('?', 2)).finally(() => {
                const spans = memoryExporter.getFinishedSpans();
                expect(spans[0].name).toBe('select');
                expect(spans[0].status.code).toBe(CanonicalCode.OK);
                expect(spans[0].attributes[DatabaseAttribute.DB_SYSTEM]).toBe('sqlite');
                expect(spans[0].attributes[DatabaseAttribute.DB_NAME]).toBe(':memory:');
                expect(spans[0].attributes[DatabaseAttribute.DB_STATEMENT]).toBe('select ?\nwith [2]');
                done();
            });
        });
    });

    it('should attach error messages to spans', (done) => {
        const span = provider.getTracer('default').startSpan('test span');
        provider.getTracer('default').withSpan(span, () => {
            connection.raw('SLECT 2+2').catch((e: Error) => {
                const spans = memoryExporter.getFinishedSpans();
                expect(spans).toHaveLength(1);
                expect(spans[0].attributes[DatabaseAttribute.DB_SYSTEM]).toBe('sqlite');
                expect(spans[0].attributes[DatabaseAttribute.DB_NAME]).toBe(':memory:');
                expect(spans[0].attributes[DatabaseAttribute.DB_STATEMENT]).toBe('SLECT 2+2');
                expect(spans[0].status.code).toBe(CanonicalCode.UNKNOWN);
                expect(spans[0].status.message).toBe(e.message);
                done();
            });
        });
    });
});
