FROM rust:1.89 AS builder
WORKDIR /app
COPY . .
RUN cargo build --release --bin canonflo-api

FROM debian:bookworm-slim
RUN apt-get update && \
    apt-get install -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/canonflo-api /usr/local/bin/canonflo-api
EXPOSE 8080
CMD ["canonflo-api"]
