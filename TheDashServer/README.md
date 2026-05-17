# TheDashServer

TheDashServer is the sync and management backend for **TheDash** — your personal dashboard.

It lets you connect multiple TheDash instances (PCs, laptops, etc.) to a central server to synchronize your data, manage connected devices, and recover deleted items from a 30-day archive.

---

## Features

- **Multi-client sync** — Connect multiple TheDash instances to one server
- **Management web UI** — See all connected clients, their status, storage usage, and archives
- **Archive system** — Items deleted from TheDash are archived server-side for 30 days before auto-purge
- **Storage monitoring** — Track storage usage per client
- **Linux-only** — Designed to run on Ubuntu or Arch Linux (server or home machine)

---

## Requirements

- Node.js 18+
- npm
- MySQL 8+ **or** MariaDB 10.6+

---

## Installation

### Ubuntu

```bash
# 1. Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Copy TheDashServer to your server
cd /opt
sudo git clone https://github.com/you/TheDash.git
cd TheDash/TheDashServer

# 3. Install dependencies
npm install

# 4. Configure environment
cp .env.example .env
nano .env   # Set ADMIN_PASSWORD and SESSION_SECRET

# 5. Start
npm start
```

### Arch Linux

```bash
# 1. Install Node.js
sudo pacman -S nodejs npm

# 2. Copy TheDashServer to your server
cd /opt
sudo git clone https://github.com/you/TheDash.git
cd TheDash/TheDashServer

# 3. Install dependencies
npm install

# 4. Configure environment
cp .env.example .env
nano .env   # Set ADMIN_PASSWORD and SESSION_SECRET

# 5. Start
npm start
```

---

## Run as a systemd service (Ubuntu & Arch)

```bash
sudo nano /etc/systemd/system/thedash-server.service
```

Paste (adjust paths and username):

```ini
[Unit]
Description=TheDashServer
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/opt/TheDash/TheDashServer
ExecStart=/usr/bin/node server.js
Restart=on-failure
EnvironmentFile=/opt/TheDash/TheDashServer/.env

[Install]
WantedBy=multi-user.target
```

Then enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now thedash-server
sudo systemctl status thedash-server
```

---

## Configuration

Copy `.env.example` to `.env` and edit:

| Variable                  | Description                              | Default              |
|---------------------------|------------------------------------------|----------------------|
| `PORT`                    | HTTPS port to listen on                  | `3100`               |
| `ADMIN_PASSWORD`          | Password for the management UI           | *(required)*         |
| `SESSION_SECRET`          | Secret for session cookies               | *(required)*         |
| `ARCHIVE_RETENTION_DAYS`  | Days before archived items are purged    | `30`                 |
| `SSL_KEY_PATH`            | Path to your TLS private key file        | `./ssl/key.pem`      |
| `SSL_CERT_PATH`           | Path to your TLS certificate file        | `./ssl/cert.pem`     |
| `DB_HOST`                 | MySQL/MariaDB host                       | `127.0.0.1`          |
| `DB_PORT`                 | MySQL/MariaDB port                       | `3306`               |
| `DB_USER`                 | MySQL user                               | `thedash`            |
| `DB_PASSWORD`             | MySQL password                           | *(required)*         |
| `DB_NAME`                 | MySQL database name                      | `thedash`            |

---

## Management UI

Open `https://your-server-ip:3100` in your browser.

Log in with the password set in `ADMIN_PASSWORD`. From there you can:

- View all connected TheDash clients (online/offline, last seen, storage used)
- Delete a client and all its data
- Browse archived items per client and restore or permanently delete them
- Manually purge expired archives

---

## TheDash Client API

TheDash connects to TheDashServer using the following REST API (base: `http://server:3100/api/client`).

| Method | Endpoint          | Description                                      |
|--------|-------------------|--------------------------------------------------|
| POST   | `/register`       | Register a new client, returns `apiKey`          |
| POST   | `/heartbeat`      | Keep-alive + update storage info                 |
| POST   | `/sync`           | Bulk sync data items                             |
| POST   | `/archive`        | Send a deleted item to the server archive        |
| GET    | `/archives`       | Get own archived items                           |
| DELETE | `/archive/:id`    | Permanently delete an archived item              |

All endpoints except `/register` require the header `X-Api-Key: <your-api-key>`.

---

## Archive behaviour

- When TheDash deletes an item, it calls `POST /api/client/archive` to send the item to the server.
- The item is kept in the archive for **30 days** (configurable via `ARCHIVE_RETENTION_DAYS`).
- Every night at 02:00 the server purges all expired archive entries automatically.
- From the management UI you can restore (view + copy) any archived item before it expires, or delete it early.
