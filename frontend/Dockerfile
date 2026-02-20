FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=http://localhost:8000
ARG VITE_GRAFANA_DASHBOARD_URL=http://localhost:3000/d/vector-flow/vector-flow-overview

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_GRAFANA_DASHBOARD_URL=${VITE_GRAFANA_DASHBOARD_URL}

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . ./
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
