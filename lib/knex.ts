/* eslint-disable no-invalid-this, @typescript-eslint/no-this-alias */
import { BasePlugin } from '@opentelemetry/core';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import type knexTypes from 'knex';
import shimmer from 'shimmer';
import path from 'path';
import { Attributes, CanonicalCode, SpanKind } from '@opentelemetry/api';

interface KnexQuery {
    method?: string;
    options?: Record<string, unknown>;
    timeout?: boolean;
    cancelOnTimeout?: boolean;
    bindings?: unknown[];
    __knexQueryUid?: string;
    sql: string;
}

interface ClientPrototype {
    query(obj: KnexQuery): Promise<unknown>;
}

const basedir = path.dirname(require.resolve('knex'));
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-var-requires
const version = require(path.join(basedir, 'package.json')).version;

export class KnexPlugin extends BasePlugin<knexTypes> {
    public readonly supportedVersions = ['0.21.*'];
    public static readonly COMPONENT = 'knex';

    protected readonly _basedir = basedir;
    protected _internalFilesList = {
        '*': {
            client: 'lib/client',
        },
    };

    public constructor(public readonly moduleName: string, public readonly version: string) {
        super('@myrotvorets/opentelemetry-plugin-knex', '1.0.0');
    }

    protected patch(): knexTypes {
        // istanbul ignore else
        if (this._internalFilesExports.client) {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const proto = (this._internalFilesExports.client as Function).prototype as knexTypes.Client;
            const self = this;
            shimmer.wrap(proto, 'query', (original) => {
                return function (
                    this: knexTypes.Client,
                    connection: unknown,
                    query: KnexQuery | string,
                ): Promise<unknown> {
                    const q = typeof query === 'string' ? { sql: query } : query;
                    const span = self._tracer.startSpan(q.method ?? q.sql, {
                        kind: SpanKind.CLIENT,
                        attributes: {
                            [DatabaseAttribute.DB_SYSTEM]: this.config.client,
                            ...KnexPlugin.getConnectionAttributes(this.config),
                            [DatabaseAttribute.DB_STATEMENT]: q.bindings?.length
                                ? `${q.sql}\nwith [${q.bindings}]`
                                : q.sql,
                        },
                    });

                    const returned = original.call(this, connection, query) as Promise<unknown>;
                    return returned.then(
                        (result: unknown) => {
                            return new Promise((resolve) => {
                                span.setStatus({ code: CanonicalCode.OK });
                                span.end();
                                resolve(result);
                            });
                        },
                        (e: Error) => {
                            return new Promise((_, reject) => {
                                span.setStatus({
                                    code: CanonicalCode.UNKNOWN,
                                    message: e.message,
                                });
                                span.end();
                                reject(e);
                            });
                        },
                    );
                };
            });
        }

        return this._moduleExports;
    }

    protected unpatch(): knexTypes {
        // istanbul ignore else
        if (this._internalFilesExports.client) {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const proto = (this._internalFilesExports.client as Function).prototype as ClientPrototype;
            shimmer.unwrap(proto, 'query');
        }

        return this._moduleExports;
    }

    private static getConnectionAttributes(config: knexTypes.Config): Attributes {
        // istanbul ignore if
        if (typeof config.connection === 'function' || config.connection === undefined) {
            return {};
        }

        const conn: string | knexTypes.StaticConnectionConfig = config.connection;

        // istanbul ignore else
        if (typeof conn === 'object') {
            switch (config.client) {
                case 'sqlite':
                case 'sqlite3': {
                    const connection = conn as knexTypes.Sqlite3ConnectionConfig;
                    return {
                        [DatabaseAttribute.DB_NAME]: connection.filename,
                    };
                }

                case 'mysql':
                case 'mysql2' /* istanbul ignore next */: {
                    const connection = conn as knexTypes.MySqlConnectionConfig | knexTypes.MariaSqlConnectionConfig;
                    return {
                        [DatabaseAttribute.DB_USER]: connection.user,
                        [DatabaseAttribute.DB_NAME]:
                            (connection as knexTypes.MySqlConnectionConfig).database ??
                            (connection as knexTypes.MariaSqlConnectionConfig).db,
                    };
                }

                case 'pg':
                case 'postgres':
                case 'postgresql':
                case 'redshift':
                case 'mssql':
                case 'oracledb' /* istanbul ignore next */: {
                    const connection = conn as
                        | knexTypes.PgConnectionConfig
                        | knexTypes.MsSqlConnectionConfig
                        | knexTypes.OracleDbConnectionConfig;
                    return {
                        [DatabaseAttribute.DB_USER]: connection.user,
                        [DatabaseAttribute.DB_NAME]: connection.database,
                    };
                }

                default: /* istanbul ignore next */ {
                    const connection = conn as knexTypes.ConnectionConfig;
                    return {
                        [DatabaseAttribute.DB_USER]: connection.user,
                        [DatabaseAttribute.DB_NAME]: connection.database,
                    };
                }
            }
        }

        // istanbul ignore next
        return {
            [DatabaseAttribute.DB_CONNECTION_STRING]: config.connection,
        };
    }
}

export const plugin = new KnexPlugin('knex', version);
