# HomeLink Dashboard 🏡

A lightweight, self-hosted homelab dashboard with custom themes, health-check pings, and multi-user profile support.

## 🚀 Quick Start (Docker Compose)

1. Create a project directory on your server:
   ```bash
   mkdir -p ~/docker/homelink/data && cd ~/docker/homelink

2) Create your compose.yaml file:

YAML
services:
  homelink:
    image: node:20-alpine
    container_name: homelink-dashboard
    restart: unless-stopped
    ports:
      - 8580:8580
    working_dir: /app
    command: sh -c "npm install && node server.js"
    volumes:
      - ./data:/app/data
      - .:/app
      
(Note: Using relative paths ./data and . automatically maps correctly to whichever user directory you place it in, removing the need for hardcoded usernames!)

3) Start the container:

Bash
docker compose up -d

(Your dashboard will be available at http://<your-server-ip>:8580.)

*Note that this project was vibe coded using Gemini and Nathan's brain. The full code can be found here and in the project itself*
