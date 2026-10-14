# Stage 1: Build React frontend
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./

# The lockfile is made on Windows and lacks the Linux native build of vite's bundler (npm bug 4828), so install fresh.
RUN rm -f package-lock.json && npm install

COPY . .

RUN npm run build

# Stage 2: Serve with Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
