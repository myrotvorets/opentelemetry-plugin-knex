import { type Span, SpanKind, SpanStatusCode, context, diag, trace } from '@opentelemetry/api';
import {
    InstrumentationBase,
    type InstrumentationConfig,
    type InstrumentationModuleDefinition,
    InstrumentationNodeModuleDefinition,
    InstrumentationNodeModuleFile,
    isWrapped,
} from '@opentelemetry/instrumentation';
import type { Knex } from 'knex';
import { ATTR_DB_QUERY_TEXT, ATTR_DB_SYSTEM } from '@opentelemetry/semantic-conventions/incubating';
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

const supportedVersions = ['^1.0.0', '^2.0.0', '^3.0.0'];

const _STORED_PARENT_SPAN = Symbol.for('opentelemetry.stored-parent-span');

export class KnexInstrumentation extends InstrumentationBase {
    public static readonly COMPONENT = 'knex';

    public constructor(config?: InstrumentationConfig) {
        super('@myrotvorets/opentelemetry-plugin-knex', '1.0.0', config ?? {});
    }

    protected init(): InstrumentationModuleDefinition[] {
        const { patch, unpatch } = this.getClientPatches();
        return [
            new InstrumentationNodeModuleDefinition('knex', supportedVersions, undefined, undefined, [
                new InstrumentationNodeModuleFile('knex/lib/client.js', supportedVersions, patch, unpatch),
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
        const where = fallback as Record<typeof _STORED_PARENT_SPAN, Span | undefined>;
        const span = trace.getSpan(context.active()) ?? where[_STORED_PARENT_SPAN];
        if (span) {
            where[_STORED_PARENT_SPAN] = span;
        }

        return span;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/class-methods-use-this
    private readonly patchAddParentSpan = (original: (...params: unknown[]) => any): typeof original => {
        return function (this: unknown, ...params: unknown[]): unknown {
            KnexInstrumentation.ensureParentSpan(this);
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
                    return result;
                },
                (e: unknown) => {
                    const err = e instanceof Error ? e : new Error(String(e), { cause: e });
                    span.recordException(err);
                    span.setStatus({ code: SpanStatusCode.ERROR }).end();
                    throw err;
                },
            );
        };
    };

    private createSpan(client: Knex.Client, query: KnexQuery | string): Span {
        const q = typeof query === 'string' ? { sql: query } : query;
        const parentSpan = KnexInstrumentation.ensureParentSpan(client);

        return this.tracer.startSpan(
            q.method ?? q.sql,
            {
                kind: SpanKind.CLIENT,
                attributes: {
                    [ATTR_DB_SYSTEM]: client.driverName,
                    ...new ConnectionAttributes(client.connectionSettings).getAttributes(),
                    [ATTR_DB_QUERY_TEXT]: q.bindings?.length ? `${q.sql}\nwith [${q.bindings}]` : q.sql,
                },
            },
            parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined,
        );
    }
}
