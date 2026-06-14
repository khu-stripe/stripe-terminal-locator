# Stripe Terminal Locator

A community-driven web app to find Stripe Terminal reader locations across multiple countries. Built with Node.js, Express, Leaflet.js, and Supabase.

**Live:** https://stl.kekebox.com

## Features

- Interactive map with location pins
- Google OAuth and email/password authentication
- Photo uploads with compression
- Community voting on location accuracy
- Leaderboard and referral system
- Multi-country support
- Dark/light mode
- Custom Stripe Terminal cursor

## Getting Started

### Prerequisites

- Node.js 14+
- A [Supabase](https://supabase.com) project
- (Optional) [Vercel](https://vercel.com) account for deployment

### Installation

```bash
git clone https://github.com/khu-stripe/stripe-terminal-locator.git
cd stripe-terminal-locator
npm install
```

### Environment Variables

Copy the example env file and fill in your credentials:

```bash
cp env.example .env
```

Edit `.env` with your values:

```
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000
```

The client loads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the server at runtime via the `/api/config` endpoint — no credentials are stored in static files.

### Run Locally

```bash
npm start        # production
npm run dev      # development (auto-restart with nodemon)
```

Open http://localhost:3000

## Third-Party Service Setup

### Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Settings > API** and copy:
   - Project URL → `SUPABASE_URL`
   - `anon` public key → `SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`
3. Run the database schema — go to **SQL Editor**, paste the contents of `supabase-schema.sql`, and execute
4. Enable **Google OAuth**:
   - Go to **Authentication > Providers > Google**
   - Enable it and add your Google OAuth client ID and secret
   - Set the redirect URL to your domain (e.g. `https://your-project-ref.supabase.co/auth/v1/callback`)
5. Create a **Storage bucket**:
   - The schema SQL creates a `location-photos` bucket automatically
   - If it doesn't exist, go to **Storage** and create a public bucket named `location-photos`

### Google OAuth (for Supabase Auth)

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `https://<your-supabase-ref>.supabase.co/auth/v1/callback`
4. Copy Client ID and Client Secret into Supabase Authentication > Providers > Google

### Vercel (Deployment)

1. Install Vercel CLI: `npm i -g vercel`
2. Run `vercel` and follow prompts to link the project
3. Set environment variables in Vercel dashboard:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Deploy: `vercel --prod`

## API Endpoints

All write endpoints require authentication (Bearer token in Authorization header).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/config` | No | Client config (public Supabase URL + anon key) |
| GET | `/api/locations` | No | List locations (optional `?country=SG`) |
| POST | `/api/locations` | Yes | Create a location |
| PUT | `/api/locations/:id` | Yes | Update a location |
| DELETE | `/api/locations/:id` | Yes | Delete a location |
| POST | `/api/locations/:id/vote` | Yes | Vote on a location |
| GET | `/api/locations/:id/vote/:userId` | No | Get user's vote |
| POST | `/api/locations/:id/photos` | Yes | Add photos |
| GET | `/api/users/:id/referral-code` | No | Get referral code |
| POST | `/api/users/:id/referral-code` | Yes | Generate new referral code |
| POST | `/api/users/process-referral` | Yes | Process a referral |
| GET | `/api/referrals/leaderboard` | No | Referral leaderboard |

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (Google OAuth, email/password)
- **Storage:** Supabase Storage (photo uploads)
- **Map:** Leaflet.js + OpenStreetMap
- **Geocoding:** Nominatim
- **Deployment:** Vercel

## License

MIT
