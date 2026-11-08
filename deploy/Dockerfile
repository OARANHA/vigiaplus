# Fundação VigiaPlus — imagem sem dependências externas.
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--enable-source-maps"

COPY package.json ./
COPY src ./src
COPY tests ./tests
COPY scripts ./scripts

# Sem `npm install`: o núcleo usa apenas módulos built-in do Node.
# Isso reduz superfície de ataque e elimina a cadeia de suprimentos no H0.
RUN addgroup -S vigia && adduser -S -G vigia vigia \
 && chown -R vigia:vigia /app
USER vigia

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
