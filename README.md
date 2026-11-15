HomeLink Dashboard 🏠

A lightweight, high-performance, self-hosted homelab dashboard featuring custom themes, health-check pings, live API stats (Sonarr, Radarr, Prowlarr, qBittorrent, Immich), and multi-user profile support. Designed with a sleek Tailwind CSS glassmorphism interface and zero external telemetry.

✨ Key Features

Live Service Health Pings: Asynchronously pings your homelab containers in the background with real-time green/red status indicators.

Smart API Stats Integration: Pulls live data straight onto your service tiles:

Sonarr / Radarr / Prowlarr: Active queue counts.

qBittorrent: Live download speed and active torrent counters (plus idle verification).

Immich: Total indexed photo and video library counts.

Multi-User Profiles & Permissions: Isolate tile layouts, category tabs, and wallpapers per user, secured with optional passwords and direct links.

Interactive Background Studio: Live pan, zoom, scale, and dimmer controls for custom background wallpapers.

Scoped Local Asset Manager: Upload and manage personal icons and wallpapers with visual gallery previews.

Auto-Bootstrapping: Automatically provisions configuration and database files on first boot for a flawless out-of-the-box experience.



🚀 Quick Start Guide (For Beginners)

Follow these simple steps to install HomeLink on your Docker server (such as Ubuntu, Debian, TrueNAS SCALE, or Unraid).

Step 1: Create Your Project Directory

Open your server terminal via SSH and run the following commands to create and enter your HomeLink directory:

mkdir -p ~/docker/homelink/data && cd ~/docker/homelink


Step 2: Download the Example Compose File

Download or copy the compose.example.yaml file from this repository and save it locally as compose.yaml:

curl -o compose.yaml https://raw.githubusercontent.com/nathanberrynet/home_link/main/compose.example.yaml


(Alternatively, you can create the file using nano compose.yaml and copy the contents from compose.example.yaml).

Step 3: Start the Container

Run Docker Compose in detached mode to pull dependencies, clone the app, and start the server:

docker compose up -d


Step 4: Access Your Dashboard

Open your web browser and navigate to:

http://<your-server-ip>:8580


That's it! HomeLink will automatically generate a default configuration on first boot with sample tiles, ready for you to customize.




🛠️ Customization & Management

Unlocking the Dashboard: Click the "Locked" button in the top navigation bar to enter Edit Mode. Once unlocked, you can add new links, drag and drop tiles to reorder them, or edit existing services.

Adding API Keys: Edit any service tile, select your service type (Sonarr, Radarr, Prowlarr, qBittorrent, or Immich), and paste your API key to enable live stats badges.

Backups & Migration: Go to Settings (Sliders icon) > Backup & Migration to export your complete JSON backup or import existing Heimdall dashboard exports.




🔧 Troubleshooting

If your dashboard loads the top header and clock but buttons do not respond, or if you notice permission issues on fresh installs:




Check Container Logs:

docker compose logs -f homelink


Fix Data Directory Permissions:
If Docker created the ./data folder with root permissions, run:

sudo chown -R $USER:$USER data




Restart Container:

docker compose restart homelink




📝 License & Credits

Vibe-coded using Gemini and Nathan's brain. Free and open-source for personal homelab use.
