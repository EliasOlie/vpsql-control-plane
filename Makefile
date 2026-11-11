.PHONY: all build build-api build-cli build-frontend dev up down logs clean test

all: build

build: build-api build-cli build-frontend

build-api:
	@echo "==> Building VPSQL API..."
	cd api && go build -o bin/vpsql-server ./cmd/server

build-cli:
	@echo "==> Building VPSQL CLI..."
	cd cli && go build -o bin/vpsql .

build-frontend:
	@echo "==> Building VPSQL Frontend..."
	cd frontend && pnpm run build

dev-api:
	cd api && go run ./cmd/server

dev-frontend:
	cd frontend && pnpm dev

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f

clean:
	rm -rf api/bin cli/bin frontend/.next
