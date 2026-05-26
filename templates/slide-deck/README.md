# Slide Deck

Interactive slide deck presenter with sessions, live slide tracking, and audience chat.

## Getting started

```bash
# Deploy app to Fabric and start the local dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to view the app.

## Features

- **Multiple slideshows** — Create slideshows using Markdown or HTML formats
- **Live sessions** — Start a presentation session and share a join code with your audience
- **Slide tracking** — Audience members follow the presenter's current slide in real-time (via polling)
- **Live chat** — Presenter and audience can chat during the session (via polling)
- **Sample content** — Includes sample Markdown and HTML slideshows to get started

## Project structure

```text
├── rayfin/
│   ├── rayfin.yml          # Fabric service configuration
│   └── data/
│       ├── schema.ts       # Data schema (Slideshow, Session, ChatMessage)
│       ├── Slideshow.ts    # Slideshow entity
│       ├── Session.ts      # Presentation session entity
│       └── ChatMessage.ts  # Chat message entity
├── src/
│   ├── main.tsx            # Entry point + Rayfin client bootstrap
│   ├── App.tsx             # Routes and auth gate
│   ├── components/
│   │   ├── AuthPage.tsx    # Sign-in page
│   │   ├── ChatPanel.tsx   # Chat sidebar with polling
│   │   └── SlideRenderer.tsx # Renders markdown or HTML slides
│   ├── data/
│   │   └── sampleSlideshows.ts  # Sample slideshow content
│   ├── hooks/
│   │   ├── AuthContext.tsx # Auth state management
│   │   └── usePolling.ts   # Generic polling hook
│   ├── pages/
│   │   ├── HomePage.tsx    # Slideshow gallery + session management
│   │   ├── PresenterPage.tsx # Presenter view with controls + chat
│   │   └── AudiencePage.tsx  # Audience view with live tracking + chat
│   └── services/
│       ├── bootstrap.ts    # Auth bootstrapping
│       ├── chat.ts         # Chat message CRUD
│       ├── sessions.ts     # Session CRUD + slide tracking
│       ├── slideshows.ts   # Slideshow CRUD
│       └── rayfinClient.ts # Rayfin client singleton
└── package.json
```

## Data model

| Entity | Purpose |
|--------|---------|
| `Slideshow` | Stores slideshow metadata and slide content (JSON) |
| `Session` | Tracks a live presentation session with current slide index |
| `ChatMessage` | Chat messages within a session |

## How it works

1. **Create slideshows** — Add markdown or HTML slideshows (sample content included)
2. **Start a session** — Pick a slideshow and start a presentation session
3. **Share the join code** — Audience enters the 6-character code to join
4. **Present** — Use arrow keys or buttons to navigate slides; audience follows along automatically via polling
5. **Chat** — Both presenter and audience can send messages during the session

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Deploy app to Fabric and start local dev server |
| `npm run build` | Production build |
| `npm run build:fabric` | Build for Fabric deployment |
| `npm run lint` | Lint with ESLint |
| `npm run test` | Run unit tests with Vitest |
| `npm run rayfin:up` | Deploy app to Fabric (no local dev server) |
