import { AttributeValue, Attributes } from '@opentelemetry/api';
import {
    ATTR_DB_NAMESPACE,
    // eslint-disable-next-line import/no-deprecated, sonarjs/deprecation, @typescript-eslint/no-deprecated
    ATTR_DB_USER,
    ATTR_NETWORK_PEER_PORT,
    ATTR_SERVER_ADDRESS,
} from '@opentelemetry/semantic-conventions/incubating';
import type { Knex } from 'knex';

// eslint-disable-next-line sonarjs/function-return-type
function findAttribute(where: Record<string, unknown>, keys: string[]): AttributeValue | undefined {
    for (const key of keys) {
        const value = where[key];
        if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
            return value;
        }
    }

    return undefined;
}

export class ConnectionAttributes {
    private readonly attributes: Attributes = {};

    public constructor(connection: Readonly<Knex.StaticConnectionConfig>) {
        this.parseConnection(connection);
    }

    public getAttributes(): Readonly<Attributes> {
        return this.attributes;
    }

    private parseConnection(connection: Readonly<Knex.StaticConnectionConfig>): void {
        this.setDbName(connection);
        this.setDbUser(connection);
        this.setNetAttributes(connection);
    }

    private setDbName(connection: Readonly<Knex.StaticConnectionConfig>): void {
        const database = findAttribute(connection, ['filename', 'db', 'database']);
        // istanbul ignore else
        if (database) {
            this.attributes[ATTR_DB_NAMESPACE] = database;
        }
    }

    private setDbUser(connection: Readonly<Knex.StaticConnectionConfig>): void {
        const user = findAttribute(connection, ['user']);
        // istanbul ignore if
        if (user) {
            // eslint-disable-next-line sonarjs/deprecation, @typescript-eslint/no-deprecated
            this.attributes[ATTR_DB_USER] = user;
        }
    }

    private setNetAttributes(connection: Readonly<Knex.StaticConnectionConfig>): void {
        const name = findAttribute(connection, ['host', 'server', 'unixSocket', 'socketPath']);
        const port = findAttribute(connection, ['port']);

        // istanbul ignore if
        if (port) {
            this.attributes[ATTR_NETWORK_PEER_PORT] = port;
        }

        // istanbul ignore if
        if (name) {
            this.attributes[ATTR_SERVER_ADDRESS] = name;
        }
    }
}
