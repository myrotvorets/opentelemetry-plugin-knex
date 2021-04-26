/* eslint-disable promise/no-return-wrap */
import { Span, SpanKind, SpanStatusCode, context, diag, getSpan, setSpan } from '@opentelemetry/api';
import {
    InstrumentationBase,
    InstrumentationConfig,
    InstrumentationModuleDefinition,
    InstrumentationNodeModuleDefinition,
    InstrumentationNodeModuleFile,
    isWrapped,
} from '@opentelemetry/instrumentation';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import type { Knex } from 'knex';
import { ConnectionAttributes } from './connectionattributes';

interface KnexQuery {
    method?: string;
    options?: Record<string, unknown>;
    timeout?: boolean;
    cancelOnTimeout?: boolean;
    bindings?: unknown[];
    __knexQueryUid?: string;
    sql: string;
}

const supportedVersions = ['^0.21.0', '^0.95.0'];

const _STORED_PARENT_SPAN = Symbol.for('opentelemetry.stored-parent-span');

export class KnexPlugin extends InstrumentationBase<Knex> {
    public static readonly COMPONENT = 'knex';

    public constructor(config?: InstrumentationConfig) {
        super('@myrotvorets/opentelemetry-plugin-knex', '1.0.0', config);
    }

    protected init(): InstrumentationModuleDefinition<Knex>[] {
        const { patch, unpatch } = this.getClientPatches();
        return [
            new InstrumentationNodeModuleDefinition<Knex>('knex', supportedVersions, undefined, undefined, [
                new InstrumentationNodeModuleFile<typeof Knex.Client>(
                    'knex/lib/client.js',
                    supportedVersions,
                    patch,
                    unpatch,
                ),
            ]),
        ];
    }

    private getClientPatches<T extends typeof Knex.Client>(): {
        patch: (exports: T, version?: string) => T;
        unpatch: (exports?: T, version?: string) => void;
    } {
        return {
            patch: (moduleExports: T, moduleVersion?: string): T => {
                diag.debug(`Applying patch for knex@${moduleVersion}`);

                // istanbul ignore else
                // eslint-disable-next-line @typescript-eslint/unbound-method
                if (!isWrapped(moduleExports.prototype.queryBuilder)) {
                    this._massWrap([moduleExports.prototype], ['queryBuilder', 'raw'], this.patchAddParentSpan);
                    this._wrap(moduleExports.prototype, 'query', this.patchQuery);
                }

                return moduleExports;
            },
            unpatch: (moduleExports?: T, moduleVersion?: string): void => {
                // istanbul ignore else
                if (moduleExports !== undefined) {
                    diag.debug(`Removing patch for knex@${moduleVersion}`);
                    this._massUnwrap([moduleExports.prototype], ['query', 'queryBuilder', 'raw']);
                }
            },
        };
    }

    private static ensureParentSpan(fallback: unknown): Span | undefined {
        const where = fallback as Record<typeof _STORED_PARENT_SPAN, Span>;
        const span = getSpan(context.active()) || where[_STORED_PARENT_SPAN];
        if (span) {
            where[_STORED_PARENT_SPAN] = span;
        }

        return span;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly patchAddParentSpan = (original: (...params: unknown[]) => any): typeof original => {
        return function (this: unknown, ...params: unknown[]): unknown {
            KnexPlugin.ensureParentSpan(this);
            return original.apply(this, params);
        };
    };

    private readonly patchQuery = (
        original: (connection: unknown, obj: unknown) => Promise<unknown>,
    ): ((connection: unknown, obj: KnexQuery | string) => Promise<unknown>) => {
        const self = this;
        return function (this: Knex.Client, connection: unknown, query: KnexQuery | string): Promise<unknown> {
            const span = self.createSpan(this, query);
            return original.call(this, connection, query).then(
                (result: unknown) => {
                    span.setStatus({ code: SpanStatusCode.OK }).end();
                    return Promise.resolve(result);
                },
                (e: Error) => {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: e.message }).end();
                    return Promise.reject(e);
                },
            );
        };
    };

    private createSpan(client: Knex.Client, query: KnexQuery | string): Span {
        const q = typeof query === 'string' ? { sql: query } : query;
        const parentSpan = KnexPlugin.ensureParentSpan(client);

        return this.tracer.startSpan(
            q.method ?? q.sql,
            {
                kind: SpanKind.CLIENT,
                attributes: {
                    [SemanticAttributes.DB_SYSTEM]: client.driverName,
                    ...new ConnectionAttributes(client.connectionSettings).getAttributes(),
                    [SemanticAttributes.DB_STATEMENT]: q.bindings?.length ? `${q.sql}\nwith [${q.bindings}]` : q.sql,
                },
            },
            parentSpan ? setSpan(context.active(), parentSpan) : undefined,
        );
    }
}
