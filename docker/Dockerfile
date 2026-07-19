# Match Playwright version in package.json
FROM mcr.microsoft.com/playwright:v1.58.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    LOGA3_GUI_HOST=0.0.0.0 \
    LOGA3_GUI_PORT=3847 \
    LOGA3_HEADLESS=1 \
    LOGA3_DOWNLOADS_DIR=/app/downloads \
    LOGA3_LOGS_DIR=/app/logs \
    LOGA3_PORTABLE_ROOT=/app/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p downloads logs data \
    && chown -R pwuser:pwuser /app

USER pwuser

EXPOSE 3847

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3847/',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["npm", "run", "gui"]
