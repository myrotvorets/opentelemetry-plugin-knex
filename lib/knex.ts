/* eslint-disable no-invalid-this */
import { CanonicalCode, Span, SpanKind } from '@opentelemetry/api';
import { BasePlugin } from '@opentelemetry/core';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import type knexTypes from 'knex';
import shimmer from 'shimmer';
import path from 'path';
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

interface IPackage {
    name: string;
    version: string;
}

const knexBaseDir = path.dirname(require.resolve('knex'));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexVersion = (require(path.join(knexBaseDir, 'package.json')) as IPackage).version;

const _STORED_PARENT_SPAN = Symbol.for('opentelemetry.stored-parent-span');

export class KnexPlugin extends BasePlugin<knexTypes> {
    public readonly supportedVersions = ['0.21.*'];
    public static readonly COMPONENT = 'knex';

    protected readonly _basedir = knexBaseDir;
    protected _internalFilesList = {
        '*': {
            client: 'lib/client',
        },
    };

    private enabled = false;

    public constructor(public readonly moduleName: string, public readonly version: string) {
        super('@myrotvorets/opentelemetry-plugin-knex', '1.0.0');
    }

    protected patch(): knexTypes {
        // istanbul ignore else
        if (!this.enabled && this._internalFilesExports.client) {
            const proto = (this._internalFilesExports.client as ObjectConstructor).prototype as knexTypes.Client;
            shimmer.massWrap([proto], ['queryBuilder', 'raw'], (original) => this.patchAddParentSpan(original));
            shimmer.wrap(proto, 'query', (original) => this.patchQuery(original));

            this.enabled = true;
        }

        return this._moduleExports;
    }

    protected unpatch(): void {
        // istanbul ignore else
        if (this.enabled && this._internalFilesExports.client) {
            const proto = (this._internalFilesExports.client as ObjectConstructor).prototype as knexTypes.Client;
            shimmer.massUnwrap([proto], ['query', 'queryBuilder', 'raw']);
            this.enabled = false;
        }
    }

    private ensureParentSpan(fallback: unknown): Span | undefined {
        const where = fallback as Record<typeof _STORED_PARENT_SPAN, Span>;
        const span = this._tracer.getCurrentSpan() || where[_STORED_PARENT_SPAN];
        if (span) {
            where[_STORED_PARENT_SPAN] = span;
        }

        return span;
    }

    private patchAddParentSpan(original: (...params: unknown[]) => unknown): (...params: unknown[]) => unknown {
        const self = this;
        return function (this: unknown, ...params: unknown[]): unknown {
            self.ensureParentSpan(this);
            return original.apply(this, params);
        };
    }

    private patchQuery(
        original: (connection: unknown, obj: unknown) => Promise<unknown>,
    ): (connection: unknown, obj: KnexQuery | string) => Promise<unknown> {
        const self = this;
        return function (this: knexTypes.Client, connection: unknown, query: KnexQuery | string): Promise<unknown> {
            const span = self.createSpan(this, query);
            return original.call(this, connection, query).then(
                (result: unknown) => {
                    span.setStatus({ code: CanonicalCode.OK }).end();
                    return Promise.resolve(result);
                },
                (e: Error) => {
                    span.setStatus({ code: CanonicalCode.UNKNOWN, message: e.message }).end();
                    return Promise.reject(e);
                },
            );
        };
    }

    private createSpan(client: knexTypes.Client, query: KnexQuery | string): Span {
        const q = typeof query === 'string' ? { sql: query } : query;
        return this._tracer.startSpan(q.method ?? q.sql, {
            kind: SpanKind.CLIENT,
            attributes: {
                [DatabaseAttribute.DB_SYSTEM]: client.driverName,
                ...new ConnectionAttributes(client.connectionSettings).getAttributes(),
                [DatabaseAttribute.DB_STATEMENT]: q.bindings?.length ? `${q.sql}\nwith [${q.bindings}]` : q.sql,
            },
            parent: this.ensureParentSpan(client),
        });
    }
}

export const plugin = new KnexPlugin('knex', knexVersion);
