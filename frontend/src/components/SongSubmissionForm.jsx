import { useState } from 'react';

function SongSubmissionForm() {
  const [formData, setFormData] = useState({
    song_title: '',
    artist_name: '',
    album_name: '',
    release_year: '',
    youtube_url: '',
    lyrics_excerpt: '',
    submission_reason: '',
    submitter_name: '',
    submitter_email: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};
    
    // Required fields
    if (!formData.song_title.trim()) {
      newErrors.song_title = 'Song title is required';
    }
    
    if (!formData.artist_name.trim()) {
      newErrors.artist_name = 'Artist name is required';
    }
    
    // Optional field validations
    if (formData.release_year && (isNaN(formData.release_year) || formData.release_year < 1900 || formData.release_year > new Date().getFullYear() + 1)) {
      newErrors.release_year = 'Please enter a valid year';
    }
    
    if (formData.submitter_email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(formData.submitter_email)) {
      newErrors.submitter_email = 'Please enter a valid email address';
    }
    
    if (formData.youtube_url && !formData.youtube_url.includes('youtube.com') && !formData.youtube_url.includes('youtu.be')) {
      newErrors.youtube_url = 'Please enter a valid YouTube URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear error for this field when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setMessage(null);
    
    try {
      const response = await fetch('http://localhost:5000/api/submissions/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (response.ok) {
        setMessage({
          type: 'success',
          text: result.already_exists 
            ? `Thank you for your suggestion! We found "${result.submission.song_title}" by ${result.submission.artist_name} is already in our playlist. Your submission has been noted for admin review.`
            : `Thank you for suggesting "${result.submission.song_title}" by ${result.submission.artist_name}! Our team will review your submission.`
        });
        
        // Reset form on success
        setFormData({
          song_title: '',
          artist_name: '',
          album_name: '',
          release_year: '',
          youtube_url: '',
          lyrics_excerpt: '',
          submission_reason: '',
          submitter_name: '',
          submitter_email: ''
        });
      } else {
        setMessage({
          type: 'error',
          text: result.error || 'Failed to submit your suggestion. Please try again.'
        });
      }
    } catch (error) {
      console.error('Submission error:', error);
      setMessage({
        type: 'error',
        text: 'Network error. Please check your connection and try again.'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Suggest a Song</h1>
        <p>Help us grow our vegan music collection! Submit songs that promote veganism, animal rights, or environmental consciousness.</p>
      </div>

      <div className="submission-form-container">
        <form onSubmit={handleSubmit} className="submission-form">
          {/* Required Fields Section */}
          <div className="form-section">
            <h3>Song Information <span className="required">*Required</span></h3>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="song_title">Song Title *</label>
                <input
                  type="text"
                  id="song_title"
                  name="song_title"
                  value={formData.song_title}
                  onChange={handleInputChange}
                  className={errors.song_title ? 'error' : ''}
                  placeholder="Enter the song title"
                  disabled={loading}
                />
                {errors.song_title && <span className="error-message">{errors.song_title}</span>}
              </div>

              <div className="form-group">
                <label htmlFor="artist_name">Artist Name *</label>
                <input
                  type="text"
                  id="artist_name"
                  name="artist_name"
                  value={formData.artist_name}
                  onChange={handleInputChange}
                  className={errors.artist_name ? 'error' : ''}
                  placeholder="Enter the artist or band name"
                  disabled={loading}
                />
                {errors.artist_name && <span className="error-message">{errors.artist_name}</span>}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="album_name">Album Name</label>
                <input
                  type="text"
                  id="album_name"
                  name="album_name"
                  value={formData.album_name}
                  onChange={handleInputChange}
                  placeholder="Enter the album name (optional)"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="release_year">Release Year</label>
                <input
                  type="number"
                  id="release_year"
                  name="release_year"
                  value={formData.release_year}
                  onChange={handleInputChange}
                  className={errors.release_year ? 'error' : ''}
                  placeholder="e.g. 2023"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  disabled={loading}
                />
                {errors.release_year && <span className="error-message">{errors.release_year}</span>}
              </div>
            </div>
          </div>

          {/* Optional Information Section */}
          <div className="form-section">
            <h3>Additional Information <span className="optional">Optional</span></h3>
            
            <div className="form-group">
              <label htmlFor="youtube_url">YouTube Link</label>
              <input
                type="url"
                id="youtube_url"
                name="youtube_url"
                value={formData.youtube_url}
                onChange={handleInputChange}
                className={errors.youtube_url ? 'error' : ''}
                placeholder="https://youtube.com/watch?v=..."
                disabled={loading}
              />
              {errors.youtube_url && <span className="error-message">{errors.youtube_url}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="lyrics_excerpt">Key Lyrics</label>
              <textarea
                id="lyrics_excerpt"
                name="lyrics_excerpt"
                value={formData.lyrics_excerpt}
                onChange={handleInputChange}
                placeholder="Share a few lines that demonstrate the vegan/animal rights theme..."
                rows="3"
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="submission_reason">Why should this song be included?</label>
              <textarea
                id="submission_reason"
                name="submission_reason"
                value={formData.submission_reason}
                onChange={handleInputChange}
                placeholder="Tell us why this song fits our vegan music collection..."
                rows="4"
                disabled={loading}
              />
            </div>
          </div>

          {/* Contact Information Section */}
          <div className="form-section">
            <h3>Your Information <span className="optional">Optional</span></h3>
            <p className="section-description">Leave your details if you'd like us to credit you or follow up on your submission.</p>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="submitter_name">Your Name</label>
                <input
                  type="text"
                  id="submitter_name"
                  name="submitter_name"
                  value={formData.submitter_name}
                  onChange={handleInputChange}
                  placeholder="Your name (optional)"
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="submitter_email">Your Email</label>
                <input
                  type="email"
                  id="submitter_email"
                  name="submitter_email"
                  value={formData.submitter_email}
                  onChange={handleInputChange}
                  className={errors.submitter_email ? 'error' : ''}
                  placeholder="your@email.com (optional)"
                  disabled={loading}
                />
                {errors.submitter_email && <span className="error-message">{errors.submitter_email}</span>}
              </div>
            </div>
          </div>

          {/* Message Display */}
          {message && (
            <div className={`message ${message.type}`}>
              <p>{message.text}</p>
            </div>
          )}

          {/* Submit Button */}
          <div className="form-actions">
            <button 
              type="submit" 
              className="submit-button" 
              disabled={loading}
            >
              {loading ? '🎵 Submitting...' : '🎵 Submit Song Suggestion'}
            </button>
          </div>
        </form>

        {/* Information Sidebar */}
        <div className="submission-info">
          <h3>Submission Guidelines</h3>
          <ul>
            <li><strong>Vegan Themes:</strong> Songs should promote veganism, animal rights, or environmental consciousness</li>
            <li><strong>Explicit Content:</strong> All content levels are welcome - we categorize appropriately</li>
            <li><strong>Any Genre:</strong> From metal to folk, electronic to hip-hop - all genres welcome!</li>
            <li><strong>Review Process:</strong> Our team reviews submissions and adds qualifying songs to the playlist</li>
          </ul>
          
          <div className="submission-stats">
            <h4>Community Impact</h4>
            <p>Help us build the world's largest collection of vegan music!</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SongSubmissionForm;