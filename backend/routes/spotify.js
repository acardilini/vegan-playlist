const express = require('express');
const SpotifyWebApi = require('spotify-web-api-node');
const pool = require('../database/db');
const { getParentGenres, getAllSubgenres } = require('../utils/genreMapping');
const router = express.Router();

// Initialize Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Get access token (for public playlists, we don't need user auth)
const getAccessToken = async () => {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    return data.body['access_token'];
  } catch (error) {
    console.error('Error getting access token:', error);
    throw error;
  }
};

// Test Spotify connection
router.get('/test', async (req, res) => {
  try {
    await getAccessToken();
    res.json({ message: 'Spotify API connected successfully!' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to connect to Spotify API' });
  }
});

// Get playlist tracks
router.get('/playlist/:playlistId', async (req, res) => {
  try {
    await getAccessToken();
    const { playlistId } = req.params;
    
    // Get playlist info
    const playlistData = await spotifyApi.getPlaylist(playlistId);
    
    // Get all tracks (handle pagination)
    let allTracks = [];
    let offset = 0;
    const limit = 50;
    
    while (true) {
      const tracksData = await spotifyApi.getPlaylistTracks(playlistId, {
        offset: offset,
        limit: limit,
        fields: 'items(track(id,name,artists,album,duration_ms,popularity,external_urls,preview_url)),next'
      });
      
      allTracks = allTracks.concat(tracksData.body.items);
      
      if (!tracksData.body.next) break;
      offset += limit;
    }
    
    // Format the data
    const formattedTracks = allTracks.map(item => {
      const track = item.track;
      return {
        spotifyId: track.id,
        title: track.name,
        artists: track.artists.map(artist => ({
          id: artist.id,
          name: artist.name,
          spotifyUrl: artist.external_urls?.spotify
        })),
        album: {
          id: track.album.id,
          name: track.album.name,
          releaseDate: track.album.release_date,
          images: track.album.images
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        spotifyUrl: track.external_urls?.spotify,
        previewUrl: track.preview_url
      };
    });
    
    res.json({
      playlist: {
        id: playlistData.body.id,
        name: playlistData.body.name,
        description: playlistData.body.description,
        trackCount: playlistData.body.tracks.total
      },
      tracks: formattedTracks
    });
    
  } catch (error) {
    console.error('Error fetching playlist:', error);
    res.status(500).json({ error: 'Failed to fetch playlist data' });
  }
});

// Get additional track features
router.get('/features/:trackIds', async (req, res) => {
  try {
    await getAccessToken();
    const trackIds = req.params.trackIds.split(',');
    
    const features = await spotifyApi.getAudioFeaturesForTracks(trackIds);
    res.json(features.body);
  } catch (error) {
    console.error('Error fetching audio features:', error);
    res.status(500).json({ error: 'Failed to fetch audio features' });
  }
});

// Get artist details
router.get('/artist/:artistId', async (req, res) => {
  try {
    await getAccessToken();
    const { artistId } = req.params;
    
    const artistData = await spotifyApi.getArtist(artistId);
    res.json(artistData.body);
  } catch (error) {
    console.error('Error fetching artist:', error);
    res.status(500).json({ error: 'Failed to fetch artist data' });
  }
});

// Database test routes
router.get('/db-stats', async (req, res) => {
  try {
    const songCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    res.json({
      songs: parseInt(songCount.rows[0].count),
      artists: parseInt(artistCount.rows[0].count),
      albums: parseInt(albumCount.rows[0].count)
    });
  } catch (error) {
    console.error('Database stats error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

router.get('/db-songs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.title, a.name as artist, al.name as album, 
             s.duration_ms, s.popularity, s.spotify_url
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      JOIN albums al ON s.album_id = al.id
      ORDER BY s.title
      LIMIT 20
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Database songs error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get all songs with pagination
router.get('/songs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.preview_url,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT a.spotify_id) as artist_ids
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, al.id
      ORDER BY s.title
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    
    // Get total count for pagination
    const countResult = await pool.query('SELECT COUNT(*) FROM songs');
    const totalSongs = parseInt(countResult.rows[0].count);
    
    res.json({
      songs: result.rows,
      pagination: {
        page,
        limit,
        total: totalSongs,
        pages: Math.ceil(totalSongs / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching songs:', error);
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Get featured/random songs for homepage - WITH CUSTOM MOODS
router.get('/songs/featured', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.playlist_added_at,
        s.energy,
        s.danceability,
        s.valence,
        s.tempo,
        s.custom_mood,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT genre_elem) FILTER (WHERE genre_elem IS NOT NULL) as artist_genres
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true
      GROUP BY s.id, s.spotify_id, s.title, s.duration_ms, s.popularity, s.spotify_url, 
               s.playlist_added_at, s.energy, s.danceability, s.valence, s.tempo, s.custom_mood,
               al.name, al.release_date, al.images
      ORDER BY RANDOM()
      LIMIT $1
    `, [limit]);
    
    // SIMPLIFIED: No post-processing needed, artist_genres are included in query
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching enhanced featured songs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch enhanced featured songs',
      details: error.message 
    });
  }
});

// Get single song by ID
router.get('/songs/:id', async (req, res) => {
  try {
    const songId = req.params.id;
    
    const result = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.preview_url,
        s.explicit,
        s.track_number,
        s.disc_number,
        s.playlist_added_at,
        s.energy,
        s.danceability,
        s.valence,
        s.acousticness,
        s.instrumentalness,
        s.liveness,
        s.speechiness,
        s.tempo,
        s.loudness,
        s.key,
        s.mode,
        s.time_signature,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        al.spotify_url as album_spotify_url,
        ARRAY_AGG(DISTINCT jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'spotify_id', a.spotify_id,
          'spotify_url', a.spotify_url,
          'genres', a.genres,
          'popularity', a.popularity,
          'followers', a.followers
        )) as artists
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE s.id = $1
      GROUP BY s.id, al.id
    `, [songId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching song:', error);
    res.status(500).json({ error: 'Failed to fetch song' });
  }
});

// Get all artists
router.get('/artists', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.name,
        a.spotify_id,
        a.spotify_url,
        COUNT(DISTINCT s.id) as song_count
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      GROUP BY a.id
      ORDER BY song_count DESC, a.name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching artists:', error);
    res.status(500).json({ error: 'Failed to fetch artists' });
  }
});

// Advanced search and filter songs
router.get('/search', async (req, res) => {
  try {
    const { 
      q: query, 
      vegan_focus, 
      animal_category, 
      advocacy_style, 
      advocacy_issues,
      lyrical_explicitness,
      year_from,
      year_to,
      energy_min,
      energy_max,
      danceability_min,
      danceability_max,
      valence_min,
      valence_max,
      genres,
      parent_genres,
      page = 1,
      limit = 20,
      sort_by = 'popularity'
    } = req.query;

    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    // Text search
    if (query && query.trim()) {
      const searchTerm = `%${query.trim()}%`;
      whereConditions.push(`(
        LOWER(s.title) LIKE LOWER($${paramIndex}) OR 
        LOWER(a.name) LIKE LOWER($${paramIndex}) OR
        LOWER(al.name) LIKE LOWER($${paramIndex}) OR
        LOWER(s.your_review) LIKE LOWER($${paramIndex})
      )`);
      queryParams.push(searchTerm);
      paramIndex++;
    }

    // Vegan focus filter
    if (vegan_focus) {
      const focuses = Array.isArray(vegan_focus) ? vegan_focus : [vegan_focus];
      whereConditions.push(`s.vegan_focus && $${paramIndex}::text[]`);
      queryParams.push(focuses);
      paramIndex++;
    }

    // Animal category filter
    if (animal_category) {
      const categories = Array.isArray(animal_category) ? animal_category : [animal_category];
      whereConditions.push(`s.animal_category && $${paramIndex}::text[]`);
      queryParams.push(categories);
      paramIndex++;
    }

    // Advocacy style filter
    if (advocacy_style) {
      const styles = Array.isArray(advocacy_style) ? advocacy_style : [advocacy_style];
      whereConditions.push(`s.advocacy_style && $${paramIndex}::text[]`);
      queryParams.push(styles);
      paramIndex++;
    }

    // Advocacy issues filter
    if (advocacy_issues) {
      const issues = Array.isArray(advocacy_issues) ? advocacy_issues : [advocacy_issues];
      whereConditions.push(`s.advocacy_issues && $${paramIndex}::text[]`);
      queryParams.push(issues);
      paramIndex++;
    }

    // Lyrical explicitness filter
    if (lyrical_explicitness) {
      const explicitness = Array.isArray(lyrical_explicitness) ? lyrical_explicitness : [lyrical_explicitness];
      whereConditions.push(`s.lyrical_explicitness && $${paramIndex}::text[]`);
      queryParams.push(explicitness);
      paramIndex++;
    }

    // Year range filter
    if (year_from) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) >= $${paramIndex}`);
      queryParams.push(parseInt(year_from));
      paramIndex++;
    }
    if (year_to) {
      whereConditions.push(`EXTRACT(YEAR FROM al.release_date) <= $${paramIndex}`);
      queryParams.push(parseInt(year_to));
      paramIndex++;
    }

    // Audio feature filters
    if (energy_min !== undefined) {
      whereConditions.push(`s.energy >= $${paramIndex}`);
      queryParams.push(parseFloat(energy_min));
      paramIndex++;
    }
    if (energy_max !== undefined) {
      whereConditions.push(`s.energy <= $${paramIndex}`);
      queryParams.push(parseFloat(energy_max));
      paramIndex++;
    }
    if (danceability_min !== undefined) {
      whereConditions.push(`s.danceability >= $${paramIndex}`);
      queryParams.push(parseFloat(danceability_min));
      paramIndex++;
    }
    if (danceability_max !== undefined) {
      whereConditions.push(`s.danceability <= $${paramIndex}`);
      queryParams.push(parseFloat(danceability_max));
      paramIndex++;
    }
    if (valence_min !== undefined) {
      whereConditions.push(`s.valence >= $${paramIndex}`);
      queryParams.push(parseFloat(valence_min));
      paramIndex++;
    }
    if (valence_max !== undefined) {
      whereConditions.push(`s.valence <= $${paramIndex}`);
      queryParams.push(parseFloat(valence_max));
      paramIndex++;
    }

    // Genre filtering (specific subgenres) - SIMPLIFIED: Use artist genres
    if (genres) {
      const genreList = Array.isArray(genres) ? genres : [genres];
      whereConditions.push(`EXISTS (
        SELECT 1 FROM song_artists sa2 
        JOIN artists a2 ON sa2.artist_id = a2.id 
        WHERE sa2.song_id = s.id 
        AND a2.genres && $${paramIndex}::text[]
      )`);
      queryParams.push(genreList);
      paramIndex++;
    }
    
    // Parent genre filtering (higher-level genres) - SIMPLIFIED: Use artist genres
    if (parent_genres) {
      const parentGenreList = Array.isArray(parent_genres) ? parent_genres : [parent_genres];
      
      // Map parent genres to their subgenres for filtering
      const genreMapping = {
        'metal': ['metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent'],
        'punk': ['punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk'],
        'hardcore': ['hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo'],
        'rock': ['blues rock', 'hard rock', 'alternative rock', 'indie rock', 'classic rock', 'progressive rock', 'psychedelic rock', 'garage rock', 'gothic rock', 'industrial rock', 'art rock', 'acid rock', 'grunge', 'post-grunge', 'britpop', 'madchester', 'krautrock', 'noise rock', 'neo-psychedelic', 'folk rock', 'celtic rock', 'brazilian rock'],
        'folk': ['folk punk', 'anti-folk', 'indie folk', 'folk rock', 'acoustic folk', 'contemporary folk', 'folk', 'traditional folk', 'americana', 'celtic', 'singer-songwriter', 'country blues'],
        'blues': ['blues', 'blues rock', 'electric blues', 'acoustic blues', 'delta blues'],
        'pop': ['pop', 'indie pop', 'electropop', 'synthpop', 'power pop', 'dream pop', 'jangle pop', 'swedish pop', 'german pop', 'new wave', 'pop soul'],
        'electronic': ['electronic', 'ambient', 'techno', 'house', 'drum and bass', 'dubstep', 'edm', 'industrial', 'ebm', 'darkwave', 'coldwave', 'cold wave', 'downtempo', 'trip hop', 'glitch', 'witch house', 'footwork', 'bassline', 'riddim', 'minimalism', 'neoclassical'],
        'hip-hop': ['hip hop', 'rap', 'conscious hip hop', 'alternative hip hop', 'underground hip hop', 'east coast hip hop', 'experimental hip hop', 'hardcore hip hop', 'old school hip hop', 'gangster rap', 'horrorcore', 'grime', 'uk grime'],
        'reggae': ['reggae', 'ska', 'dub', 'roots reggae', 'nz reggae', 'lovers rock', 'ragga', 'dancehall', 'rocksteady'],
        'jazz': ['free jazz', 'hard bop'],
        'soul': ['philly soul', 'pop soul', 'gospel', 'gospel r&b']
      };
      
      // Get all subgenres for the selected parent genres
      const allSubgenres = [];
      parentGenreList.forEach(parent => {
        if (genreMapping[parent]) {
          allSubgenres.push(...genreMapping[parent]);
        }
      });
      
      if (allSubgenres.length > 0) {
        whereConditions.push(`EXISTS (
          SELECT 1 FROM song_artists sa2 
          JOIN artists a2 ON sa2.artist_id = a2.id 
          WHERE sa2.song_id = s.id 
          AND a2.genres && $${paramIndex}::text[]
        )`);
        queryParams.push(allSubgenres);
        paramIndex++;
      }
    }

    // Build WHERE clause
    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    // Sorting options
    let orderBy = 'ORDER BY s.popularity DESC, s.title';
    switch (sort_by) {
      case 'title':
        orderBy = 'ORDER BY s.title ASC';
        break;
      case 'year':
        orderBy = 'ORDER BY al.release_date DESC NULLS LAST, s.title ASC';
        break;
      case 'artist':
        orderBy = 'ORDER BY MIN(a.name) ASC, s.title ASC';
        break;
      case 'energy':
        orderBy = 'ORDER BY s.energy DESC NULLS LAST, s.title ASC';
        break;
      case 'danceability':
        orderBy = 'ORDER BY s.danceability DESC NULLS LAST, s.title ASC';
        break;
      case 'valence':
        orderBy = 'ORDER BY s.valence DESC NULLS LAST, s.title ASC';
        break;
      default:
        orderBy = 'ORDER BY s.popularity DESC, s.title ASC';
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const searchQuery = `
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.energy,
        s.danceability,
        s.valence,
        s.vegan_focus,
        s.animal_category,
        s.advocacy_style,
        s.advocacy_issues,
        s.lyrical_explicitness,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists,
        ARRAY_AGG(DISTINCT genre_elem) FILTER (WHERE genre_elem IS NOT NULL) as artist_genres
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      LEFT JOIN LATERAL UNNEST(COALESCE(a.genres, ARRAY[]::text[])) AS genre_elem ON true
      ${whereClause}
      GROUP BY s.id, al.id
      ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await pool.query(searchQuery, queryParams);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT s.id) as total
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      ${whereClause}
    `;
    
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    res.json({
      songs: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      filters_applied: {
        query: query || null,
        vegan_focus: vegan_focus || null,
        animal_category: animal_category || null,
        advocacy_style: advocacy_style || null,
        advocacy_issues: advocacy_issues || null,
        lyrical_explicitness: lyrical_explicitness || null,
        year_range: { from: year_from || null, to: year_to || null },
        energy_range: { min: energy_min || null, max: energy_max || null },
        danceability_range: { min: danceability_min || null, max: danceability_max || null },
        valence_range: { min: valence_min || null, max: valence_max || null },
        genres: genres || null,
        sort_by
      }
    });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ error: 'Failed to search songs', details: error.message });
  }
});

// Get filter options and counts
router.get('/filter-options', async (req, res) => {
  try {
    // Get all unique filter values with counts
    const veganFocusQuery = `
      SELECT UNNEST(vegan_focus) as value, COUNT(*) as count
      FROM songs 
      WHERE vegan_focus IS NOT NULL 
      GROUP BY UNNEST(vegan_focus)
      ORDER BY count DESC
    `;
    
    const animalCategoryQuery = `
      SELECT UNNEST(animal_category) as value, COUNT(*) as count
      FROM songs 
      WHERE animal_category IS NOT NULL 
      GROUP BY UNNEST(animal_category)
      ORDER BY count DESC
    `;
    
    const advocacyStyleQuery = `
      SELECT UNNEST(advocacy_style) as value, COUNT(*) as count
      FROM songs 
      WHERE advocacy_style IS NOT NULL 
      GROUP BY UNNEST(advocacy_style)
      ORDER BY count DESC
    `;
    
    const advocacyIssuesQuery = `
      SELECT UNNEST(advocacy_issues) as value, COUNT(*) as count
      FROM songs 
      WHERE advocacy_issues IS NOT NULL 
      GROUP BY UNNEST(advocacy_issues)
      ORDER BY count DESC
    `;
    
    const lyricalExplicitnessQuery = `
      SELECT UNNEST(lyrical_explicitness) as value, COUNT(*) as count
      FROM songs 
      WHERE lyrical_explicitness IS NOT NULL 
      GROUP BY UNNEST(lyrical_explicitness)
      ORDER BY count DESC
    `;
    
    // SIMPLIFIED: Use artist genres directly - this is the source of truth
    const genresQuery = `
      SELECT 
        UNNEST(a.genres) as value, 
        COUNT(DISTINCT s.id) as count
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      WHERE a.genres IS NOT NULL
      GROUP BY UNNEST(a.genres)
      ORDER BY count DESC, value ASC
    `;
    
    // SIMPLIFIED: Calculate parent genres from artist genres directly
    const parentGenresQuery = `
      WITH artist_genre_mapping AS (
        SELECT 
          DISTINCT s.id,
          CASE 
            WHEN genre_val IN ('metalcore', 'deathcore', 'mathcore', 'groove metal', 'death metal', 'black metal', 'thrash metal', 'doom metal', 'progressive metal', 'nu metal', 'melodic death metal', 'sludge metal', 'stoner metal', 'grindcore', 'heavy metal', 'alternative metal', 'industrial metal', 'speed metal', 'rap metal', 'djent') THEN 'metal'
            WHEN genre_val IN ('punk', 'hardcore punk', 'skate punk', 'ska punk', 'folk punk', 'pop punk', 'post-punk', 'anarcho-punk', 'street punk', 'queercore', 'riot grrrl', 'indie punk', 'celtic punk', 'proto-punk', 'egg punk') THEN 'punk'
            WHEN genre_val IN ('hardcore', 'melodic hardcore', 'post-hardcore', 'crossover hardcore', 'screamo', 'midwest emo') THEN 'hardcore'
            WHEN genre_val IN ('blues rock', 'hard rock', 'alternative rock', 'indie rock', 'classic rock', 'progressive rock', 'psychedelic rock', 'garage rock', 'gothic rock', 'industrial rock', 'art rock', 'acid rock', 'grunge', 'post-grunge', 'britpop', 'madchester', 'krautrock', 'noise rock', 'neo-psychedelic', 'folk rock', 'celtic rock', 'brazilian rock') THEN 'rock'
            WHEN genre_val IN ('folk punk', 'anti-folk', 'indie folk', 'folk rock', 'acoustic folk', 'contemporary folk', 'folk', 'traditional folk', 'americana', 'celtic', 'singer-songwriter', 'country blues') THEN 'folk'
            WHEN genre_val IN ('blues', 'blues rock', 'electric blues', 'acoustic blues', 'delta blues') THEN 'blues'
            WHEN genre_val IN ('pop', 'indie pop', 'electropop', 'synthpop', 'power pop', 'dream pop', 'jangle pop', 'swedish pop', 'german pop', 'new wave', 'pop soul') THEN 'pop'
            WHEN genre_val IN ('electronic', 'ambient', 'techno', 'house', 'drum and bass', 'dubstep', 'edm', 'industrial', 'ebm', 'darkwave', 'coldwave', 'cold wave', 'downtempo', 'trip hop', 'glitch', 'witch house', 'footwork', 'bassline', 'riddim', 'minimalism', 'neoclassical') THEN 'electronic'
            WHEN genre_val IN ('hip hop', 'rap', 'conscious hip hop', 'alternative hip hop', 'underground hip hop', 'east coast hip hop', 'experimental hip hop', 'hardcore hip hop', 'old school hip hop', 'gangster rap', 'horrorcore', 'grime', 'uk grime') THEN 'hip-hop'
            WHEN genre_val IN ('reggae', 'ska', 'dub', 'roots reggae', 'nz reggae', 'lovers rock', 'ragga', 'dancehall', 'rocksteady') THEN 'reggae'
            WHEN genre_val IN ('free jazz', 'hard bop') THEN 'jazz'
            WHEN genre_val IN ('philly soul', 'pop soul', 'gospel', 'gospel r&b') THEN 'soul'
            ELSE 'other'
          END as parent_genre
        FROM songs s
        JOIN song_artists sa ON s.id = sa.song_id
        JOIN artists a ON sa.artist_id = a.id,
        UNNEST(a.genres) as genre_val
        WHERE a.genres IS NOT NULL
      )
      SELECT parent_genre as value, COUNT(DISTINCT id) as count
      FROM artist_genre_mapping
      WHERE parent_genre IS NOT NULL
      GROUP BY parent_genre
      ORDER BY count DESC, value ASC
    `;
    
    const yearRangeQuery = `
      SELECT 
        MIN(EXTRACT(YEAR FROM release_date)) as min_year,
        MAX(EXTRACT(YEAR FROM release_date)) as max_year
      FROM albums
      WHERE release_date IS NOT NULL
    `;
    
    const audioFeaturesQuery = `
      SELECT 
        MIN(energy) as min_energy, MAX(energy) as max_energy,
        MIN(danceability) as min_danceability, MAX(danceability) as max_danceability,
        MIN(valence) as min_valence, MAX(valence) as max_valence
      FROM songs
      WHERE energy IS NOT NULL OR danceability IS NOT NULL OR valence IS NOT NULL
    `;

    const [
      veganFocus,
      animalCategory,
      advocacyStyle,
      advocacyIssues,
      lyricalExplicitness,
      genres,
      parentGenres,
      yearRange,
      audioFeatures
    ] = await Promise.all([
      pool.query(veganFocusQuery),
      pool.query(animalCategoryQuery),
      pool.query(advocacyStyleQuery),
      pool.query(advocacyIssuesQuery),
      pool.query(lyricalExplicitnessQuery),
      pool.query(genresQuery),
      pool.query(parentGenresQuery),
      pool.query(yearRangeQuery),
      pool.query(audioFeaturesQuery)
    ]);

    console.log('Parent genres query result:', parentGenres.rows?.length, 'rows');
    console.log('DEBUG: About to send response with parent_genres');

    res.json({
      vegan_focus: veganFocus.rows,
      animal_category: animalCategory.rows,
      advocacy_style: advocacyStyle.rows,
      advocacy_issues: advocacyIssues.rows,
      lyrical_explicitness: lyricalExplicitness.rows,
      // Legacy support for existing genre filter
      genres: genres.rows,
      // New hierarchical genre data
      subgenres: genres.rows,
      parent_genres: parentGenres.rows.length > 0 ? parentGenres.rows : getParentGenres().map(pg => ({ value: pg, count: 0 })),
      year_range: yearRange.rows[0] || { min_year: null, max_year: null },
      audio_features: audioFeatures.rows[0] || { 
        min_energy: null, max_energy: null,
        min_danceability: null, max_danceability: null,
        min_valence: null, max_valence: null
      }
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch filter options', details: error.message });
  }
});

// Check database contents
router.get('/database-check', async (req, res) => {
  try {
    // Count totals
    const songCount = await pool.query('SELECT COUNT(*) FROM songs');
    const artistCount = await pool.query('SELECT COUNT(*) FROM artists');
    const albumCount = await pool.query('SELECT COUNT(*) FROM albums');
    
    // Sample data
    const sampleData = await pool.query(`
      SELECT 
        s.title, 
        s.spotify_id,
        s.date_added,
        s.vegan_focus,
        s.animal_category,
        array_agg(a.name) as artists
      FROM songs s
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      GROUP BY s.id, s.title, s.spotify_id, s.date_added, s.vegan_focus, s.animal_category
      LIMIT 5
    `);
    
    const schemaCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'songs' 
      ORDER BY ordinal_position
    `);
    
    res.json({
      totals: {
        songs: parseInt(songCount.rows[0].count),
        artists: parseInt(artistCount.rows[0].count),
        albums: parseInt(albumCount.rows[0].count)
      },
      sampleData: sampleData.rows,
      songsSchema: schemaCheck.rows
    });
  } catch (error) {
    console.error('Database check error:', error);
    res.status(500).json({ error: 'Database check failed' });
  }
});

// Debug endpoint to check audio features
router.get('/debug/audio-features', async (req, res) => {
  try {
    // Check if any songs have audio features
    const withFeatures = await pool.query(`
      SELECT COUNT(*) as count
      FROM songs 
      WHERE energy IS NOT NULL OR danceability IS NOT NULL
    `);
    
    // Get a sample of songs with and without features
    const sampleWithFeatures = await pool.query(`
      SELECT title, energy, danceability, valence, tempo
      FROM songs 
      WHERE energy IS NOT NULL 
      LIMIT 5
    `);
    
    const sampleWithoutFeatures = await pool.query(`
      SELECT title, spotify_id, energy, danceability, valence, tempo
      FROM songs 
      WHERE energy IS NULL 
      LIMIT 5
    `);
    
    res.json({
      summary: {
        songs_with_features: parseInt(withFeatures.rows[0].count),
        total_songs: await pool.query('SELECT COUNT(*) FROM songs').then(r => parseInt(r.rows[0].count))
      },
      samples: {
        with_features: sampleWithFeatures.rows,
        without_features: sampleWithoutFeatures.rows
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get similar songs based on vegan categories and audio features
router.get('/songs/:id/similar', async (req, res) => {
  try {
    const songId = req.params.id;
    const limit = parseInt(req.query.limit) || 6;
    
    // Simple approach: get songs with similar vegan focus or advocacy style
    const result = await pool.query(`
      WITH current_song AS (
        SELECT vegan_focus, advocacy_style, energy, danceability, valence
        FROM songs 
        WHERE id = $1
      )
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.energy,
        s.danceability,
        s.valence,
        s.vegan_focus,
        s.advocacy_style,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a.name) as artists
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN artists a ON sa.artist_id = a.id
      CROSS JOIN current_song cs
      WHERE s.id != $1
        AND (
          s.vegan_focus && cs.vegan_focus 
          OR s.advocacy_style && cs.advocacy_style
          OR (
            cs.energy IS NOT NULL AND s.energy IS NOT NULL 
            AND ABS(s.energy - cs.energy) <= 0.3
          )
        )
      GROUP BY s.id, al.id
      ORDER BY s.popularity DESC, RANDOM()
      LIMIT $2
    `, [songId, limit]);
    
    res.json({
      similar_songs: result.rows
    });
  } catch (error) {
    console.error('Error fetching similar songs:', error);
    res.status(500).json({ error: 'Failed to fetch similar songs' });
  }
});

// Search and filter artists (must come before /:id route)
router.get('/artists/search', async (req, res) => {
  try {
    const { 
      q: query,
      genres,
      min_songs = 1,
      min_followers,
      max_followers,
      min_popularity,
      max_popularity,
      year_from,
      year_to,
      page = 1,
      limit = 20,
      sort_by = 'song_count'
    } = req.query;

    let whereConditions = [];
    let queryParams = [];
    let paramIndex = 1;

    // Text search
    if (query && query.trim()) {
      const searchTerm = `%${query.trim()}%`;
      whereConditions.push(`(
        LOWER(a.name) LIKE LOWER($${paramIndex}) OR
        LOWER(a.bio) LIKE LOWER($${paramIndex}) OR
        LOWER(a.vegan_advocacy_notes) LIKE LOWER($${paramIndex})
      )`);
      queryParams.push(searchTerm);
      paramIndex++;
    }

    // Genre filter
    if (genres) {
      const genreList = Array.isArray(genres) ? genres : [genres];
      whereConditions.push(`a.genres && $${paramIndex}::text[]`);
      queryParams.push(genreList);
      paramIndex++;
    }

    // Followers filter
    if (min_followers) {
      whereConditions.push(`a.followers >= $${paramIndex}`);
      queryParams.push(parseInt(min_followers));
      paramIndex++;
    }
    if (max_followers) {
      whereConditions.push(`a.followers <= $${paramIndex}`);
      queryParams.push(parseInt(max_followers));
      paramIndex++;
    }

    // Popularity filter
    if (min_popularity) {
      whereConditions.push(`a.popularity >= $${paramIndex}`);
      queryParams.push(parseInt(min_popularity));
      paramIndex++;
    }
    if (max_popularity) {
      whereConditions.push(`a.popularity <= $${paramIndex}`);
      queryParams.push(parseInt(max_popularity));
      paramIndex++;
    }

    // Year range filter (based on earliest and latest release dates of artist's songs)
    if (year_from) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM songs s2 
        JOIN albums al2 ON s2.album_id = al2.id 
        JOIN song_artists sa2 ON s2.id = sa2.song_id 
        WHERE sa2.artist_id = a.id 
        AND EXTRACT(YEAR FROM al2.release_date) >= $${paramIndex}
      )`);
      queryParams.push(parseInt(year_from));
      paramIndex++;
    }
    if (year_to) {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM songs s2 
        JOIN albums al2 ON s2.album_id = al2.id 
        JOIN song_artists sa2 ON s2.id = sa2.song_id 
        WHERE sa2.artist_id = a.id 
        AND EXTRACT(YEAR FROM al2.release_date) <= $${paramIndex}
      )`);
      queryParams.push(parseInt(year_to));
      paramIndex++;
    }

    // Minimum songs filter
    const havingClause = `HAVING COUNT(DISTINCT s.id) >= $${paramIndex}`;
    queryParams.push(parseInt(min_songs));
    paramIndex++;

    // Build WHERE clause
    const whereClause = whereConditions.length > 0 ? 
      `WHERE ${whereConditions.join(' AND ')}` : '';

    // Sorting options
    let orderBy = 'ORDER BY song_count DESC, a.name ASC';
    switch (sort_by) {
      case 'name':
        orderBy = 'ORDER BY a.name ASC';
        break;
      case 'popularity':
        orderBy = 'ORDER BY a.popularity DESC NULLS LAST, a.name ASC';
        break;
      case 'followers':
        orderBy = 'ORDER BY a.followers DESC NULLS LAST, a.name ASC';
        break;
      default:
        orderBy = 'ORDER BY song_count DESC, a.name ASC';
    }

    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    queryParams.push(parseInt(limit), offset);

    const searchQuery = `
      SELECT 
        a.id,
        a.name,
        a.spotify_id,
        a.spotify_url,
        a.genres,
        a.images,
        a.followers,
        a.popularity,
        a.bio,
        a.vegan_advocacy_notes,
        COUNT(DISTINCT s.id) as song_count,
        AVG(s.popularity) as avg_song_popularity
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      ${whereClause}
      GROUP BY a.id
      ${havingClause}
      ${orderBy}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await pool.query(searchQuery, queryParams);

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT a.id) as total
      FROM artists a
      JOIN song_artists sa ON a.id = sa.artist_id
      JOIN songs s ON sa.song_id = s.id
      ${whereClause}
      GROUP BY a.id
      ${havingClause}
    `;
    
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const total = countResult.rows.length;

    res.json({
      artists: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      },
      filters_applied: {
        query: query || null,
        genres: genres || null,
        min_songs: parseInt(min_songs),
        min_followers: min_followers ? parseInt(min_followers) : null,
        max_followers: max_followers ? parseInt(max_followers) : null,
        min_popularity: min_popularity ? parseInt(min_popularity) : null,
        max_popularity: max_popularity ? parseInt(max_popularity) : null,
        year_range: { from: year_from || null, to: year_to || null },
        sort_by
      }
    });
  } catch (error) {
    console.error('Error in artist search:', error);
    res.status(500).json({ error: 'Failed to search artists', details: error.message });
  }
});

// Get individual artist with their songs
router.get('/artists/:id', async (req, res) => {
  try {
    const artistId = req.params.id;
    
    // Get artist details
    const artistResult = await pool.query(`
      SELECT 
        a.id,
        a.spotify_id,
        a.name,
        a.spotify_url,
        a.genres,
        a.images,
        a.followers,
        a.popularity,
        a.bio,
        a.vegan_advocacy_notes
      FROM artists a
      WHERE a.id = $1
    `, [artistId]);
    
    if (artistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' });
    }
    
    const artist = artistResult.rows[0];
    
    // Get all songs by this artist
    const songsResult = await pool.query(`
      SELECT 
        s.id,
        s.spotify_id,
        s.title,
        s.duration_ms,
        s.popularity,
        s.spotify_url,
        s.preview_url,
        s.energy,
        s.danceability,
        s.valence,
        s.vegan_focus,
        s.animal_category,
        s.advocacy_style,
        s.advocacy_issues,
        s.lyrical_explicitness,
        al.name as album_name,
        al.release_date,
        al.images as album_images,
        ARRAY_AGG(DISTINCT a2.name) as collaborators
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      JOIN song_artists sa2 ON s.id = sa2.song_id
      JOIN artists a2 ON sa2.artist_id = a2.id
      WHERE sa.artist_id = $1
      GROUP BY s.id, al.id
      ORDER BY s.popularity DESC, s.title ASC
    `, [artistId]);
    
    // Get artist statistics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(DISTINCT s.id) as total_songs,
        COUNT(DISTINCT al.id) as total_albums,
        AVG(s.popularity) as avg_popularity,
        AVG(s.energy) as avg_energy,
        AVG(s.danceability) as avg_danceability,
        AVG(s.valence) as avg_valence
      FROM songs s
      JOIN albums al ON s.album_id = al.id
      JOIN song_artists sa ON s.id = sa.song_id
      WHERE sa.artist_id = $1
    `, [artistId]);
    
    res.json({
      artist,
      songs: songsResult.rows,
      stats: statsResult.rows[0]
    });
  } catch (error) {
    console.error('Error fetching artist:', error);
    res.status(500).json({ error: 'Failed to fetch artist details' });
  }
});

module.exports = router;