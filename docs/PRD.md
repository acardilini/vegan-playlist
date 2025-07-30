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
