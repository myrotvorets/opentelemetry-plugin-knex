# opentelemetry-plugin-knex Usage Example

```sh
docker run -it --rm -d -p 9411:9411 openzipkin/zipkin
OTEL_BSP_SCHEDULE_DELAY=0 OTEL_TRACES_EXPORTER=zipkin npx ts-node src/index.ts
```