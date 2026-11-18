# Imagen genérica: APP indica la carpeta del componente (gateway, services/x-service o database)
FROM node:24-alpine
ARG APP
WORKDIR /app
COPY shared ./shared
COPY frontend ./frontend
COPY ${APP}/package*.json ./${APP}/
WORKDIR /app/${APP}
RUN npm install --omit=dev --no-audit --no-fund
COPY ${APP} .
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
