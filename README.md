# HEREMS_PLUS — School Management System

A complete, offline-first Progressive Web App for school management built for Ghanaian schools.

## Features
- 🏫 Multi-school management with Super Admin / School Admin / Teacher / Parent roles
- 📊 Student results, continuous assessment, and terminal report cards
- 💰 Fee collection, debtors tracking, canteen payments, salaries, expenditure
- 📱 SMS notifications (Arkesel, Hubtel, Termii, SMS.to)
- ☁️ Cloud sync with offline-first architecture
- 📄 Portable client files for offline use

## Quick Start

### Deploy to Netlify
1. Fork this repo
2. Go to [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
3. Select this repo → **Deploy site**
4. Done! Netlify reads `netlify.toml` and `_redirects` automatically

### Deploy to Vercel
1. Fork this repo
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import this repo
3. Done! Vercel reads `vercel.json` automatically

### Run Locally
Just open `index.html` in any modern browser. No server needed.

## Demo Login
| Role | Password |
|---|---|
| 👑 Super Admin | `acm` |
| 🏫 School Admin | `sa` |
| 👨‍🏫 Teacher | `teacher123` |

## Tech Stack
- Single-file HTML/CSS/JS (no framework, no build step)
- Service Worker for offline caching
- localStorage for data persistence
- JSONBin.io for cloud sync

## License
Proprietary — © HEREMS_PLUS
