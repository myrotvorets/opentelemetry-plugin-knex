# opentelemetry-plugin-knex Usage Example

```sh
docker run -it --rm -d -p 9411:9411 openzipkin/zipkin
OTEL_BSP_SCHEDULE_DELAY=0 OTEL_TRACES_EXPORTER=zipkin npx ts-node src/index.ts
```

Open http://127.0.0.1:9411, click "Run Query", and you will see something like this:

![sample-zipkin](https://github.com/myrotvorets/opentelemetry-plugin-knex/assets/66092015/f273a163-c182-482a-bdbd-7c9656d66a85)
