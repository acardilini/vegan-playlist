import { useState, useEffect } from 'react';

function YouTubeEmbed({ 
  videoId, 
  title = 'YouTube Video',
  width = '100%',
  height = '315',
  autoplay = false,
  showControls = true,
  modestBranding = true,
  relatedVideos = false,
  fallbackMessage = 'No video available for this song'
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Auto-hide loading after a reasonable timeout since iframe onLoad is unreliable for YouTube
  useEffect(() => {
    if (videoId && isLoading) {
      const timer = setTimeout(() => {
        setIsLoading(false);
      }, 2000); // Hide loading after 2 seconds
      
      return () => clearTimeout(timer);
    }
  }, [videoId, isLoading]);

  // Reset loading state when videoId changes
  useEffect(() => {
    if (videoId) {
      setIsLoading(true);
      setHasError(false);
    }
  }, [videoId]);

  // Don't render if no video ID
  if (!videoId) {
    return (
      <div className="youtube-embed-container no-video">
        <div className="no-video-message">
          <span className="video-icon">🎥</span>
          <p>{fallbackMessage}</p>
          <small>Music videos help bring the advocacy message to life</small>
        </div>
      </div>
    );
  }

  // Build YouTube embed URL with parameters
  const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
  
  // Add parameters
  const params = {
    autoplay: autoplay ? 1 : 0,
    controls: showControls ? 1 : 0,
    modestbranding: modestBranding ? 1 : 0,
    rel: relatedVideos ? 1 : 0,
    showinfo: 0, // Hide video info
    fs: 1, // Allow fullscreen
    cc_load_policy: 1, // Show closed captions by default
  };

  Object.entries(params).forEach(([key, value]) => {
    embedUrl.searchParams.set(key, value);
  });


  if (hasError) {
    return (
      <div className="youtube-embed-container error">
        <div className="video-error-message">
          <span className="error-icon">⚠️</span>
          <p>Unable to load video</p>
          <small>The video may be private or unavailable</small>
          <a 
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="watch-on-youtube"
          >
            Watch on YouTube ↗
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="youtube-embed-container">
      {isLoading && (
        <div className="video-loading">
          <div className="loading-spinner"></div>
          <p>Loading video...</p>
        </div>
      )}
      
      <div className="video-wrapper" style={{ display: isLoading ? 'none' : 'block' }}>
        <iframe
          width={width}
          height={height}
          src={embedUrl.toString()}
          title={title}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading="lazy"
        />
      </div>
      
      <div className="video-footer">
        <a 
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="watch-on-youtube-link"
        >
          Watch on YouTube ↗
        </a>
      </div>
    </div>
  );
}

export default YouTubeEmbed;