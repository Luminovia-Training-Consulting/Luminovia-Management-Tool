FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --chown=node:node clamav.mjs server.mjs healthcheck.mjs ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=6s --start-period=180s --retries=3 CMD ["node", "healthcheck.mjs"]
CMD ["node", "server.mjs"]
