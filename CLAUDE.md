# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Vegan Playlist is a web-based resource for vegan-themed music featuring a curated database of 650+ songs. It consists of a React frontend and Node.js/Express backend with PostgreSQL database integration and Spotify API connectivity.

## Development Commands

### Backend (Node.js/Express)
- **Development server**: `cd backend && npm run dev` (uses nodemon)
- **Production server**: `cd backend && npm start`
- **Install dependencies**: `cd backend && npm install`

### Frontend (React/Vite)
- **Development server**: `cd frontend && npm run dev`
- **Build for production**: `cd frontend && npm run build`
- **Lint code**: `cd frontend && npm run lint`
- **Preview production build**: `cd frontend && npm run preview`
- **Install dependencies**: `cd frontend && npm install`

### Database
- **Create tables**: Run `backend/database/schema.sql` against PostgreSQL database
- **Import data**: Use `backend/scripts/importSpotifyData.js` for Spotify playlist import

## Architecture

### Backend Structure (`backend/`)
- **server.js**: Main Express server with CORS and middleware setup
- **routes/spotify.js**: Spotify API integration and database queries
- **database/db.js**: PostgreSQL connection pool
- **database/schema.sql**: Database schema with songs, artists, albums, playlists tables
- **scripts/importSpotifyData.js**: Data import utilities

### Frontend Structure (`frontend/`)
- **src/App.jsx**: Main React app with routing (React Router)
- **src/api/spotifyService.js**: API service for backend communication
- **Components**: HomePage, SongDetailPage, ArtistsPage, PlaylistsPage, AboutPage
- **Vite configuration**: Uses Vite for development and builds

### Database Schema
- **Core tables**: songs, artists, albums with many-to-many relationships
- **Categorization**: Flexible TEXT[] arrays for vegan focus, advocacy styles, animal categories
- **User features**: playlists, playlist_songs for user-generated content
- **Spotify integration**: Stores spotify_id, URLs, and metadata

## Key Features

### Spotify Integration
- Uses `spotify-web-api-node` library with client credentials flow
- Fetches playlist data, track metadata, artist info, and audio features
- Backend routes: `/api/spotify/playlist/:id`, `/api/spotify/songs/featured`, `/api/spotify/search`

### Database Operations
- PostgreSQL with complex joins for song-artist-album relationships
- Full-text search across songs, artists, and albums
- Pagination support for large datasets
- Random/featured song selection for homepage

### Frontend Features
- React Router for navigation between Browse Songs, Artists, Playlists, About
- Dynamic stats display fetched from database
- Song cards with play buttons and navigation to detail pages
- Responsive design with CSS styling

## Environment Setup

### Required Environment Variables (backend/.env)
```
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DATABASE_URL=your_postgresql_connection_string
PORT=5000
```

### Development Workflow
1. Start PostgreSQL database
2. Run database schema setup
3. Configure backend environment variables
4. Start backend: `cd backend && npm run dev`
5. Start frontend: `cd frontend && npm run dev`
6. Backend runs on port 5000, frontend on Vite's default port

## Important Notes

- Backend uses PostgreSQL with connection pooling via `pg` library
- Frontend communicates with backend API at `http://localhost:5000/api/spotify`
- Song categorization system uses flexible TEXT[] arrays for multiple values per category
- Spotify API requires client credentials for public playlist access
- Project follows monorepo structure with separate package.json files for frontend/backend