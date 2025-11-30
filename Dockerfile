FROM node:18-alpine

# yt-dlp 설치
RUN apk update && apk add --no-cache yt-dlp ffmpeg

# 앱 위치
WORKDIR /app

# 패키지 먼저 복사 + 설치
COPY package*.json ./
RUN npm install

# 나머지 코드 복사
COPY . .

EXPOSE 3000

# 서버 시작
CMD ["npm", "start"]
