# 部署用镜像：纯 Node，无构建步骤
FROM node:22-alpine

WORKDIR /app

# 只有运行时需要的文件（静态站点 + 三个引擎模块 + 服务端）
COPY package.json server.mjs prompts.mjs engine.mjs opponent.mjs read.mjs ./
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=8788
ENV NODE_ENV=production

EXPOSE 8788

# 密钥不要写进镜像：用环境变量 COACH_API_KEY / COACH_BASE_URL / COACH_MODEL 注入
CMD ["node", "server.mjs"]
