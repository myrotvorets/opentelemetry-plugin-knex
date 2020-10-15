/* eslint-disable no-invalid-this, @typescript-eslint/no-this-alias */
import { BasePlugin } from '@opentelemetry/core';
import { DatabaseAttribute } from '@opentelemetry/semantic-conventions';
import type knexTypes from 'knex';
import shimmer from 'shimmer';
import path from 'path';
import { Attributes, CanonicalCode, SpanKind } from '@opentelemetry/api';

interface KnexQuery {
    method: string;
    options: Record<string, unknown>;
    timeout: boolean;
    cancelOnTimeout: boolean;
    bindings: unknown[];
    __knexQueryUid?: string;
    sql: string;
}

interface RunnerPrototype {
    query(obj: KnexQuery): Promise<unknown>;
}

interface Runner extends RunnerPrototype {
    client: knexTypes.Client;
    builder: knexTypes.QueryBuilder;
    queries: string[];
    connection?: unknown;
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
            runner: 'lib/runner',
        },
    };

    public constructor(public readonly moduleName: string, public readonly version: string) {
        super('@myrotvorets/opentelemetry-plugin-knex', '1.0.0');
    }

    protected patch(): knexTypes {
        // istanbul ignore else
        if (this._internalFilesExports.runner) {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const proto = (this._internalFilesExports.runner as Function).prototype as RunnerPrototype;
            const self = this;
            shimmer.wrap(proto, 'query', (original) => {
                return function (this: Runner, query: KnexQuery): Promise<unknown> {
                    const span = self._tracer.startSpan(query.method, {
                        kind: SpanKind.CLIENT,
                        attributes: {
                            [DatabaseAttribute.DB_SYSTEM]: this.builder.client.config.client,
                            ...KnexPlugin.getConnectionAttributes(this.builder.client.config),
                            [DatabaseAttribute.DB_STATEMENT]: query.bindings.length
                                ? `${query.sql}\nwith [${query.bindings}]`
                                : query.sql,
                        },
                    });

                    const returned = original.call(this, query);
                    // istanbul ignore else
                    if (returned.then) {
                        return returned.then(
                            (result: unknown) => {
                                span.setStatus({ code: CanonicalCode.OK });
                                span.end();
                                return result;
                            },
                            (e: Error) => {
                                span.setStatus({
                                    code: CanonicalCode.UNKNOWN,
                                    message: e.message,
                                });
                                span.end();
                                throw e;
                            },
                        );
                    }

                    /* istanbul ignore next */
                    return returned;
                };
            });
        }

        return this._moduleExports;
    }

    protected unpatch(): knexTypes {
        // istanbul ignore else
        if (this._internalFilesExports.runner) {
            // eslint-disable-next-line @typescript-eslint/ban-types
            const proto = (this._internalFilesExports.runner as Function).prototype as RunnerPrototype;
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
