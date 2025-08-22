# vegan-playlist
A comprehensive web-based resource for vegan-themed music

## Database Management & Cleanup Process

### Complete Duplicate Song Management Workflow

To properly manage and remove duplicate songs from your database, follow this step-by-step process:

1. **Find Duplicates**: Use Admin > Cleanup > "Find Duplicates" to identify duplicate songs in your database
2. **Remove from Spotify Playlist**: Go to your Spotify playlist and manually remove the duplicate songs you want to delete
3. **Update Database with New Playlist**: Run the sync script to update your database with the current playlist:
   ```bash
   cd backend && node scripts/simpleSyncSpotify.js
   ```
4. **Flag Removed Songs**: Run the flagging script to identify songs that were removed from the playlist:
   ```bash
   cd backend && node scripts/flagRemovedSongs.js
   ```
5. **Delete from Database**: Use Admin > Cleanup > "Removed from Playlist" to delete the flagged songs from your database
6. **Verify Clean Database**: Return to Admin > Cleanup > "Find Duplicates" to confirm duplicates are gone

### Additional Database Scripts

- **Preview Flagged Songs**: See which songs are flagged for removal without using the web interface:
  ```bash
  cd backend && node scripts/showRemovedSongs.js
  ```

### Why This Process?

This multi-step approach ensures:
- **No Accidental Deletions**: You manually control which songs are removed from your Spotify playlist
- **Safe Database Management**: Songs are only deleted from the database after being confirmed as removed from the playlist
- **Complete Control**: You can review all flagged songs before permanent deletion
- **Audit Trail**: Each step provides feedback and confirmation of changes made

# Backend Setup

## Environment Variables

1. Copy `.env.example` to `.env`
2. Add your actual Spotify API credentials to `.env`
3. Get credentials from: https://developer.spotify.com/dashboard

## Installation

```bash
npm install
npm run dev
