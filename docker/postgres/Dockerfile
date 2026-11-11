# Stage 1: Build do pgvector com gcc nativo (desativando geracao de bitcode LLVM para compatibilidade perfeita com Alpine)
FROM postgres:16-alpine AS builder

RUN apk add --no-cache \
    git \
    build-base

WORKDIR /tmp
RUN git clone --depth 1 --branch v0.8.0 https://github.com/pgvector/pgvector.git pgvector \
    && cd pgvector \
    && make clean \
    && make OPTFLAGS="" with_llvm=no \
    && make with_llvm=no install

# Stage 2: Imagem final leve (100% compativel com o volume do Postgres 16 Alpine existente)
FROM postgres:16-alpine

# Copia os binarios compilados diretamente para o path oficial do Postgres 16 Alpine (/usr/local)
COPY --from=builder /usr/local/lib/postgresql/vector* /usr/local/lib/postgresql/
COPY --from=builder /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
