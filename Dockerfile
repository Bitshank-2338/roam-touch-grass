FROM node:24.14-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000 DATA_DIR=/tmp/roam SEED_DEMOS=0 TRUST_PROXY=1
EXPOSE 10000
CMD ["node", "server.mjs"]
