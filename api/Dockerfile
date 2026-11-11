FROM golang:1.27.3-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/vpsql-server ./cmd/server

# Final runtime image
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl postgresql16-client

WORKDIR /app

COPY --from=builder /app/vpsql-server /app/vpsql-server

EXPOSE 8080

ENTRYPOINT ["/app/vpsql-server"]
