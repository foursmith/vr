FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
COPY cli/package.json cli/package.json
RUN bun install --frozen-lockfile

COPY . .
ARG TARGETARCH
RUN case "$TARGETARCH" in \
    amd64) target=bun-linux-x64-baseline-musl ;; \
    arm64) target=bun-linux-arm64-musl ;; \
    *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && bun run build:cli -- --target "$target"

FROM alpine:3.22 AS runtime

RUN apk add --no-cache ca-certificates libgcc libstdc++ \
  && addgroup -g 10001 -S fsvr \
  && adduser -u 10001 -S -D -H -G fsvr fsvr

COPY --from=build /app/cli/dist/fsvr /usr/local/bin/fsvr

USER fsvr
WORKDIR /media

EXPOSE 4090
VOLUME ["/media"]

ENTRYPOINT ["/usr/local/bin/fsvr", "/media", "--host"]
