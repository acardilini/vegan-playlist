# The Vegan Playlist - Product Requirements Document

## 1. Executive Summary

### Product Vision
The Vegan Playlist is a comprehensive web-based resource for vegan-themed music, featuring 650+ songs curated over 7 years. The platform serves as both a discovery tool for the vegan community and a research resource for advocacy through music.

### Primary Objectives
- Create a searchable, filterable database of vegan-themed songs
- Provide detailed analysis and reviews of each song's advocacy approach
- Enable community engagement through user-generated playlists and suggestions
- Offer data visualisation tools for exploring patterns in vegan music

### Target Audience
- **Primary**: Existing vegans seeking music that supports their advocacy
- **Secondary**: Researchers interested in advocacy through music
- **Tertiary**: Music enthusiasts curious about vegan-themed content

## 2. Product Overview

### Core Value Proposition
The most comprehensive, expertly curated collection of vegan-themed music with detailed analysis of advocacy approaches, lyrical content, and thematic categorisation.

### Key Differentiators
- Expert curation with detailed coding system for advocacy approaches
- Multi-platform song integration (Spotify, YouTube, Bandcamp, SoundCloud)
- Interactive data visualisation dashboard
- User-generated playlist creation and sharing
- Comprehensive song reviews with both written and audio analysis

## 3. Functional Requirements

### 3.1 Core Features

#### Song Database Management
- **Spotify Integration**: Automated sync with curated Spotify playlist (weekly)
- **Multi-platform Support**: Manual addition of songs from YouTube, Bandcamp, SoundCloud, etc.
- **Bulk Import**: One-time import of 650+ existing songs with progressive content enhancement
- **Metadata Capture**: All available Spotify data plus manual entry for non-Spotify songs

#### Content Management System
- **Admin Dashboard**: Private interface for content creator to manage songs, reviews, and coding
- **Preview Mode**: Review content before publishing
- **Content Status Tracking**: Visual indicators for songs needing coding/reviews
- **Dual Input Methods**: Web interface entry and spreadsheet import capability

#### Song Categorisation System
- **Hierarchical Coding Structure**: Flexible system accommodating new categories
- **Multiple Value Assignment**: Songs can have multiple values per category
- **Core Categories**:
  - **Vegan Focus**: Animals, Environment, Health
  - **Animal Category**: All animals, Farm animals, Wild animals (species-specific when applicable)
  - **Advocacy Issue Focus**: Vivisection, Eating animals, Healthy eating, etc.
  - **Lyrical Explicitness**: Direct/forthright, Confrontational, Educational, Subtle, Storytelling
  - **Additional Metadata**: Release year, album, record label, duration, language, country, date added, inclusion notes

### 3.2 User-Facing Features

#### Homepage & Navigation
- **Landing Page Elements**:
  - Playlist statistics (total songs, hours, artists)
  - Immediate search/filter access
  - Navigation menu: Browse Songs, Artists, Visualisations, Submit Suggestions, User Playlists, About
- **Responsive Design**: Equal functionality across desktop and mobile
- **About Section**: Explanation of coding system and methodology

#### Search & Discovery
- **Intuitive Visual Filters**: Aesthetically pleasing sidebar with checkboxes/dropdowns
- **Filter Counters**: Display number of songs matching each filter criteria
- **Advanced Search Interface**: Multi-field search with operators (AND/OR) and range selections
- **Full-Text Search**: Searches across song titles, lyrics, reviews, and artist names
- **Custom Playlist Creation**: Users can save and share filtered results
- **Anonymous Sharing**: Shareable links without account requirement

#### Individual Song Pages
- **Information Hierarchy**:
  1. Basic song info and coding categories
  2. YouTube video embed (click-to-play)
  3. Platform links (Spotify, Bandcamp, etc.)
  4. Detailed written review
  5. Audio review embed
  6. Social sharing buttons
  7. Similar songs navigation
- **Progressive Content Loading**: Display available information immediately, enhance as reviews are added

#### Artist Pages
- **Artist Information**:
  - All songs by artist in playlist
  - Artist statistics (song count, playlist ranking)
  - Official links and biography
  - Notes on vegan advocacy
- **Featured Artists**: Highlighting particularly strong vegan advocates

#### Visualisation Dashboard
- **Target Audience**: Casual browsers with research-quality depth
- **Interactive Elements**: Click-to-filter integration with song database
- **Visualisation Types**:
  - Timeline of songs by year
  - Genre distribution
  - Advocacy style vs. explicitness matrix
  - Geographical distribution of artists
  - Thematic evolution over time
- **Custom Visualisation Builder**: User-selectable data dimensions
- **Export Capabilities**: Data export and social media sharing of visualisations
- **Preset Analysis Views**: Curated insights and pattern showcases

### 3.3 Community Features

#### Song Suggestion System
- **Suggestion Form Fields**:
  - Song title and artist
  - Platform where found
  - Reason for vegan theme relevance
  - Submitter contact (optional)
- **Admin Queue**: Private review system for suggestions
- **Duplicate Detection**: Automatic checking against existing playlist
- **Contributor Recognition**: "User Contributed" indicators on accepted songs

#### User-Generated Playlists
- **Anonymous Creation**: No account required
- **Playlist Metadata**: Title and short description
- **Public Directory**: Showcase of all user playlists
- **Sharing System**: Unique URLs for each playlist
- **Featured Playlists**: Curated highlighting of interesting user creations

### 3.4 Analytics & Insights
- **User Interaction Tracking**:
  - Popular songs and artists
  - Common filter combinations
  - Playlist creation patterns
  - Search query analysis
- **Admin Dashboard**: Analytics interface for content creator
- **Research Data**: Exportable interaction data for academic research

## 4. Technical Requirements

### 4.1 Architecture
- **Database**: Scalable structure supporting hierarchical categorisation
- **Performance**: Fast search/filtering with database indexing
- **Mobile Responsive**: Equal functionality across all device types
- **Scalability**: Built to handle growth and increased user base

### 4.2 Third-Party Integrations
- **Spotify API**: 
  - Automated playlist sync (weekly)
  - Comprehensive metadata extraction
  - Audio features and popularity metrics
- **YouTube API**: Video embedding and metadata
- **Social Media APIs**: Sharing functionality
- **Analytics Platform**: User interaction tracking

### 4.3 Content Management
- **File Upload System**: Audio review hosting
- **Media Processing**: Optimised audio and image handling
- **Content Versioning**: Track changes to reviews and coding
- **Backup System**: Regular data backup and recovery

### 4.4 Security & Privacy
- **Data Protection**: User interaction data anonymisation
- **Admin Security**: Secure content management access
- **Content Moderation**: Spam prevention for suggestions
- **GDPR Compliance**: Data handling and user privacy

## 5. User Experience Requirements

### 5.1 Design Principles
- **Intuitive Navigation**: Self-explanatory interface requiring no tutorial
- **Aesthetic Appeal**: Professional, modern design reflecting music platform standards
- **Information Hierarchy**: Clear content prioritisation and progressive disclosure
- **Accessibility**: WCAG compliance for inclusive access

### 5.2 Performance Standards
- **Load Times**: Sub-3-second page loads
- **Search Response**: Instant filter application
- **Mobile Experience**: Touch-optimised interface
- **Offline Capability**: Basic browsing without connectivity

### 5.3 Content Presentation
- **Review Integration**: Seamless blend of data and analysis
- **Media Embedding**: Reliable video and audio playback
- **Social Features**: Easy sharing and playlist creation
- **Visual Consistency**: Coherent design language throughout

## 6. Content Strategy

### 6.1 Initial Launch
- **Content Baseline**: All 650+ songs with Spotify metadata
- **Progressive Enhancement**: Reviews and coding added post-launch
- **Launch Priority**: Search/filter functionality with basic song information

### 6.2 Ongoing Content Development
- **Review Schedule**: Systematic addition of written and audio reviews
- **Coding Completion**: Gradual categorisation of all songs
- **New Song Integration**: Weekly Spotify sync with prompt for new content
- **Community Content**: Integration of user suggestions and playlists

### 6.3 Quality Assurance
- **Review Standards**: Consistent analysis depth and format
- **Coding Accuracy**: Systematic approach to categorisation
- **User Feedback**: Community input on song relevance and coding
- **Content Moderation**: Quality control for user-generated content

## 7. Success Metrics

### 7.1 Launch Success (6 months)
- **Core Functionality**: All features operational and stable
- **Content Completion**: 100% of songs with basic information, 25% with reviews
- **User Engagement**: Regular user interaction with filtering and playlist creation
- **Community Participation**: Active song suggestions and user playlist creation

### 7.2 Long-term Objectives
- **Content Completeness**: All songs with comprehensive reviews and coding
- **Community Growth**: Expanding user base and engagement
- **Research Impact**: Academic citations and advocacy community adoption
- **Platform Stability**: Reliable performance under increased load

## 8. Implementation Phases

### Phase 1: Foundation (Months 1-2)
- Database setup and Spotify integration
- Basic website structure and navigation
- Search and filtering functionality
- Admin content management system

### Phase 2: Core Features (Months 3-4)
- Song and artist page development
- User playlist creation system
- Song suggestion form and admin queue
- Basic visualisation dashboard

### Phase 3: Enhancement (Months 5-6)
- Advanced search functionality
- Custom visualisation builder
- Analytics dashboard
- Performance optimisation and mobile refinement

### Phase 4: Community & Polish (Ongoing)
- User-generated content features
- Social sharing integration
- Advanced analytics and insights
- Continuous content addition and refinement

## 9. Risk Mitigation

### 9.1 Technical Risks
- **API Limitations**: Backup plans for Spotify API changes
- **Scalability**: Database optimisation for growth
- **Third-party Dependencies**: Fallback options for external services

### 9.2 Content Risks
- **Copyright Issues**: Proper attribution and fair use compliance
- **Content Quality**: Systematic review and coding standards
- **Community Moderation**: Spam and inappropriate content prevention

### 9.3 User Experience Risks
- **Complexity Management**: Intuitive interface despite rich functionality
- **Performance Degradation**: Optimisation strategies for large datasets
- **Mobile Accessibility**: Consistent experience across devices

## 10. Technical Specifications for LLM Development

### 10.1 Recommended Technology Stack
- **Frontend**: React.js with responsive CSS framework
- **Backend**: Node.js with Express.js
- **Database**: PostgreSQL with full-text search capabilities
- **APIs**: Spotify Web API, YouTube Data API
- **Hosting**: Scalable cloud platform (AWS/Vercel)
- **Analytics**: Google Analytics or similar

### 10.2 Database Schema Requirements
- **Songs Table**: All song metadata with flexible JSON fields for coding
- **Artists Table**: Artist information and statistics
- **User Playlists Table**: Anonymous playlist storage
- **Suggestions Table**: Song suggestion queue
- **Analytics Table**: User interaction tracking

### 10.3 Key Development Considerations
- **API Rate Limiting**: Efficient Spotify API usage
- **Search Performance**: Elasticsearch integration for complex filtering
- **Media Handling**: CDN integration for audio/video content
- **Caching Strategy**: Redis for frequently accessed data
- **Security**: Input validation and XSS prevention

This PRD provides comprehensive specifications for building The Vegan Playlist as a fully functional, scalable web application suitable for LLM-assisted development.

---

## 11. Current Feature Inventory (As-Built)

_Added 2026-07-06. Sections 1–10 describe the product vision. This section records what is
**actually implemented** in the prototype today, so the PRD reflects the full website feature
list. Status: **✅ Implemented** · **◐ Partial** · **⛔ Planned (not built)**. The definitive
keep/rebuild/drop/defer decisions are recorded in
[`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) (Session 0.1, 2026-07-07)._

### 11.1 Public Website — Pages & Routes
| Route | Page | Status | Notes |
|---|---|---|---|
| `/` | Home | ✅ | Stats display, featured songs, search entry |
| `/search` | Browse / Search Results | ✅ | Full-text search, faceted filters, sorting, pagination |
| `/song/:songId` | Song Detail | ✅ | Metadata, coding, YouTube embed, platform links, similar songs |
| `/artists` | Artists (search results) | ✅ | Artist search + filters |
| `/artist/:artistId` | Artist Detail | ✅ | Artist songs, stats, bio, advocacy notes, discography |
| `/playlists` | Playlists directory | ✅ | Curated playlist listing (browse-only — see 11.2) |
| `/playlist/:playlistId` | Playlist Detail | ✅ | Playlist songs and metadata (browse-only) |
| `/submit` | Submit a Song | ✅ | Community suggestion form |
| `/explore` | Explore → Map | ✅ | 2D canvas scatter of the catalogue in four projected spaces (B4) |
| `/explore/data` | Explore → Data | ✅ | Visualisations (Chart.js) — the former standalone Dashboard |
| `/dashboard` | _(redirect)_ | ↪ | Redirects to `/explore/data`; the Dashboard nav item is retired (B4) |
| `/about` | About | ✅ | Methodology / coding-system explanation |
| `/admin` | Admin Interface | ✅ | Private content-management console (no auth yet — see 11.5) |

### 11.2 Public Features
- **Search & discovery:** full-text search; **left-sidebar faceted filters** with **dynamic
  exclude-self counts** (each group's counts reflect the other active filters; `/api/spotify/browse-facets`);
  **effective-genre** tree (song genre, else primary artist's genre — ~1,003 live songs covered);
  **thematic analysis facet tree** with selectable codes / groups / sub-dimensions (AND-of-terms, a
  group/sub-dimension matches any code inside it); song-length / availability (Spotify·YouTube) /
  has-analysis / language filters; removable filter chips; sorting (Title/Artist/Year/Date-added)
  **with a direction toggle**; pagination. ✅ _(B3, 2026-07-20; sort direction + independently
  scrolling sidebar, triage 4, 2026-07-22.)_
- **Lyric-metadata filters:** the seven scalar analysis components (Perspective, Tone, Intensity,
  Clarity, Focus, Speaking to, Emotions) as browse filters — **OR within a component, AND across** —
  with exclude-self counts, read from each song's latest analysis pass. ✅ _(Triage 1b, 2026-07-22;
  "Speaking to" rename + latest-pass source, 2026-07-25.)_
- **Browse state in the URL:** filters, sort, direction, search and page are all query params, with a
  sessionStorage layer so a param-less return to `/` restores the last browse. ✅ _(Triage 2.)_
- **Explore map:** a hand-rolled **canvas scatter** (no charting dependency) over the **640 live songs the
  analysis has mapped**, in four projected spaces — Semantic · Thematic · Sound · Holistic — rescaled per
  space. Colour-by is a curated low-cardinality menu (five acoustic dimensions, Focus, and parent genre
  **folded to top 3 + "Other genres"** against a 5-slot palette), with absence codes drawn as neutral grey
  "Not coded". Hover card follows the cursor; **clicking a point pins the song's card in the rail rather
  than navigating** (the card carries the link — navigating on click would destroy the exploration in
  progress); the legend doubles as a multi-select spotlight; a song search dims non-matches and doubles as
  the keyboard route into the canvas. **All five view params live in the URL**, so a view is shareable and
  Back restores it. The whole map arrives in **one** response (~393KB), so no interaction refetches. The
  page states its own coverage: *"Showing 640 of 1,333 songs."* ✅ _(B4, 2026-07-27.)_
- **"You might also like" — two embedding tabs:** **Similar message** (cosine over the full 768-dim
  `lyric_embedding`) and **Similar sound** (Euclidean over the 6-dim `audio_embedding` **after
  per-dimension z-scoring** — without it the tab would be a danceability ranking). Both sets arrive in one
  response, so switching tabs makes no request. A tab is **omitted** when its embedding is missing, and
  **no similarity score is shown** — a cosine value looks like a measurement a visitor can act on and is
  not one. For the **692 of 1,333 live songs (52%) with no embeddings**, an honest **"More in this genre"**
  panel replaces the tabs. Supersedes the old genre-or-energy query, half of which was dead
  (`songs.energy` is NULL catalogue-wide). ✅ _(B4, 2026-07-27.)_
- **Sidebar presentation:** every filter group is a uniform collapsible section (only Genre & style
  open by default), with the five theme dimensions and seven metadata components nested as the same
  visual unit; visible help is usage-only (caveats, what the options mean). The definitional copy for
  each dimension/component is served by the API but **deliberately not shown in the sidebar** — it is
  destined for the About pages. ✅ _(Presentation batch, 2026-07-22.)_
- **Featured songs:** curated highlighting on the homepage (`featured` field). ✅
- **Song detail:** coding categories, platform links, similar-songs navigation. ✅
- **Lyrical analysis on the song page (Option C):** a conditional **"In short"** summary (from
  `lyric_summary`, shown only when present) above two labelled sections — **"Style & tone"** (the seven
  metadata components incl. **"Speaking to"** + Emotions) and **"What it's about"** (five thematic
  dimensions incl. **"Subjects"**, codebook-gated to match the browse filters) — with a per-section
  **"Show quotes"** toggle placing each code's evidence under its dimension. Read from each song's
  **latest analysis pass** (`MAX(analyzed_at)`; the two-tier model constants retired). ✅ _(B2; two-tier
  read + Audience row, triage 1a, 2026-07-22; Option C + latest-pass + renames + `lyric_summary` summary,
  2026-07-25.)_ **Renamed 2026-07-26 to "Song analysis"** now that the page carries audio analysis too.
- **Acoustic dimensions on the song page:** the "Style & tone" section splits into **"In the lyrics"**
  (the metadata components) and **"In the sound"** — six audio-derived cells, **Energy · Mood · Rhythm ·
  Instruments · Vocals · Tempo** (tempo as `N BPM`), each with a hover definition led by its full
  component name. Read from the same latest analysis pass; **display is ungated** (an off-codebook value
  title-cases rather than disappearing), unlike the lyrical half. ✅ _(2026-07-26.)_
- **Acoustic browse filters:** a **"Sound"** sidebar group nesting the five categorical dimensions as
  checkbox facets with exclude-self counts (OR within a component, AND across) plus a nested **"Tempo"**
  From/To BPM range. Rides the same URL + sessionStorage browse state and chip row as every other filter.
  ✅ _(2026-07-26.)_
- **YouTube integration:** per-song video embeds with a primary-video concept. ✅
- **Lyrics links:** lyrics lookup/links per song. ✅
- **Artist pages:** stats, discography tracking, advocacy notes. ✅
- **User playlists:** list/detail (browse curated playlists). ✅ — **create/add/remove
  (CRUD) moved to ⛔ deferred pending auth** (Session 3.3: the anonymous create/remove UI
  was deleted from the public site — no auth/spam story existed for it; the backend CRUD
  routes are untouched and still back the admin Manage Playlists tab). Public creation
  returns once real auth ships (Phase 4+).
- **Song submissions:** public submit + stats. ✅
- **Data dashboard:** year distribution, genre distribution, audio-features, vegan-themes,
  summary. ✅
- **Analytics of user behaviour** (popular songs, filter combinations, search queries): ⛔
  (the `/api/analytics` routes serve dataset visualisations, not user-interaction tracking).
- **Social sharing / anonymous share links:** ◐ (partial/varies by page).
- **Offline capability:** ⛔.

### 11.3 Admin / CMS Features (`/admin`)
- Song editing & full update ✅ · Bulk categorisation workflow ✅ · Bulk CSV upload ✅ ·
  Duplicate detection & management ✅ · Submissions review queue ✅ · YouTube video manager
  ✅ · Lyrics lookup manager ✅ · Data-completion dashboard ✅ · Artists manager ✅ ·
  Manual (non-Spotify) song add/edit ✅ · Featured toggle ✅.
- **Spotify playlist sync & validation:** sync playlist, detect mismatches/discrepancies,
  flag removed songs. ✅ (to be re-framed under the truth-source model — see Overview).

### 11.4 Backend API Surface (mounted routers)
Seven routers: `/api/spotify` (songs, artists, search, filter-options, browse-facets, db-stats) ·
`/api/admin` (song/artist/playlist management, categorisation, sync, cleanup) ·
`/api/playlists` (user playlist CRUD) · `/api/youtube` (video CRUD, search, extract-id) ·
`/api/submissions` (submit, admin queue, stats) · `/api/analytics` (dataset visualisation data) ·
**`/api/analysis`** (facets, per-song analysis, **`explore/points`** = the whole map in one response,
**`songs/:id/similar`** = both similarity tabs + the genre fallback).

_Corrected 2026-07-27: `/api/admin_simple` and `/api/lyrics` were deleted in Session 2.2 and are no longer
mounted; **`similar` moved from `/api/spotify` to `/api/analysis`** in B4 when it became embedding-based._

### 11.5 Data Model (implemented tables)
`artists`, `albums`, `songs` (curatorial fields `your_review`, `audio_review_url`,
`inclusion_notes`, `rating`), `song_artists`, `categories`, `song_categories`, `playlists`,
`playlist_songs`. Real lyrical analysis lives in `song_lyric_analysis` (the five mock
categorisation arrays `vegan_focus`/`animal_category`/`advocacy_style`/`advocacy_issues`/
`lyrical_explicitness` were always empty and were dropped in migration 007, sub-project B).
Extended via migrations: featured field, lyrics fields, manual-additions, YouTube videos,
song-submissions, playlist-sync.

### 11.6 Known Gaps vs. Vision (Sections 1–10)
- **Authentication/authorisation:** the admin console is not access-controlled. ⛔ (Phase 4).
- **Deployment:** no hosting, secrets strategy, or CI/CD. ⛔ (Phase 4).
- **Truth source:** data is currently Spotify-mirrored, not curator-authoritative.
  ◐ → addressed in Phase 0/1.
- **User-interaction analytics, custom visualisation builder, audio reviews, offline mode,
  GDPR tooling:** ⛔ (deferred under YAGNI until needed).

