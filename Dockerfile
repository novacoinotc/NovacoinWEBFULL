# NovaCoin web — imagen para pruebas locales / E2E (producción corre en Vercel)
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
