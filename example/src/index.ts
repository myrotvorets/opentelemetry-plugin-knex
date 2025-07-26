// This must be the very first import
import './instrumentation';

import { trace } from '@opentelemetry/api';
import { Knex, knex } from 'knex';

interface BreedModel {
    id: string;
    name: string;
    wikipedia_url: string;
}

const tracer = trace.getTracer('example');
let db: Knex;
tracer
    .startActiveSpan('Root Span', async (span) => {
        try {
            db = knex({
                client: 'better-sqlite3',
                connection: {
                    filename: ':memory:',
                },
                useNullAsDefault: true,
            });

            await db.raw(
                'CREATE TABLE cat_breeds (id CHAR(4) NOT NULL PRIMARY KEY, name VARCHAR(255), wikipedia_url VARCHAR(255) NULL)',
            );

            const r = await fetch('https://api.thecatapi.com/v1/breeds');
            const json = (await r.json()) as (BreedModel & Record<string, unknown>)[];
            const breeds = json.map((item) => ({
                id: item.id,
                name: item.name,
                wikipedia_url: item.wikipedia_url,
            }));

            await db.transaction((trx) => trx('cat_breeds').insert(breeds));
            const rows = await db('cat_breeds').select('id', 'name', 'wikipedia_url');
            // eslint-disable-next-line no-console
            console.table(rows);
        } finally {
            span.end();
        }
    })
    .catch((e) => console.error(e))
    .finally(() => {
        void db.destroy();
    });
