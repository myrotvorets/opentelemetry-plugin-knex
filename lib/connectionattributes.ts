import { AttributeValue, Attributes } from '@opentelemetry/api';
import { DatabaseAttribute, GeneralAttribute } from '@opentelemetry/semantic-conventions';
import type knexTypes from 'knex';

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

    public constructor(connection: Readonly<knexTypes.StaticConnectionConfig>) {
        this.parseConnection(connection);
    }

    public getAttributes(): Readonly<Attributes> {
        return this.attributes;
    }

    private parseConnection(connection: Readonly<knexTypes.StaticConnectionConfig>): void {
        this.setDbName(connection);
        this.setDbUser(connection);
        this.setNetAttributes(connection);
    }

    private setDbName(connection: Readonly<knexTypes.StaticConnectionConfig>): void {
        const database = findAttribute(connection, ['filename', 'db', 'database']);
        // istanbul ignore else
        if (database) {
            this.attributes[DatabaseAttribute.DB_NAME] = database;
        }
    }

    private setDbUser(connection: Readonly<knexTypes.StaticConnectionConfig>): void {
        const user = findAttribute(connection, ['user']);
        // istanbul ignore if
        if (user) {
            this.attributes[DatabaseAttribute.DB_USER] = user;
        }
    }

    private setNetAttributes(connection: Readonly<knexTypes.StaticConnectionConfig>): void {
        const host = findAttribute(connection, ['host', 'server']);
        const name = findAttribute(connection, ['unixSocket', 'socketPath']);
        const port = findAttribute(connection, ['port']);

        // istanbul ignore if
        if (host) {
            this.attributes[GeneralAttribute.NET_PEER_HOSTNAME] = host;
        }

        // istanbul ignore if
        if (port) {
            this.attributes[GeneralAttribute.NET_PEER_PORT] = port;
        }

        // istanbul ignore if
        if (name) {
            this.attributes[GeneralAttribute.NET_PEER_NAME] = name;
        }
    }
}
