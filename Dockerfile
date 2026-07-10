FROM node:20-slim AS dashboard-build
WORKDIR /workspace/app
COPY app/package*.json ./
RUN npm ci
COPY app ./
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY whatsapp-autopilot/package*.json ./
RUN npm ci --omit=dev
COPY whatsapp-autopilot ./
COPY --from=dashboard-build /workspace/app/dist ./dashboard-dist
EXPOSE 3000
CMD ["node", "server.js"]
