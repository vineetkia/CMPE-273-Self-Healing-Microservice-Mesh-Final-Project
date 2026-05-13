FROM otel/opentelemetry-collector-contrib:0.99.0

COPY otel-collector-config.yaml /etc/otel/config.yaml
CMD ["--config=/etc/otel/config.yaml"]
