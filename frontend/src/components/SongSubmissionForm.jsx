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
        <h1>Suggest a song</h1>
        <p>Help us grow the collection. Submit songs that speak to veganism, animal rights, liberation, care and connection.</p>
      </div>

      <div className="submit-layout">
        <form onSubmit={handleSubmit} className="submit-form">
          {/* Required Fields Section */}
          <div className="form-card">
            <div className="form-card-title">
              <h2>Song information</h2>
              <span className="form-tag-required">Required</span>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="song_title" className="field-label">Song title *</label>
                <input
                  type="text"
                  id="song_title"
                  name="song_title"
                  value={formData.song_title}
                  onChange={handleInputChange}
                  className={'input' + (errors.song_title ? ' input-error' : '')}
                  placeholder="Enter the song title"
                  disabled={loading}
                />
                {errors.song_title && <span className="field-error">{errors.song_title}</span>}
              </div>

              <div className="field">
                <label htmlFor="artist_name" className="field-label">Artist name *</label>
                <input
                  type="text"
                  id="artist_name"
                  name="artist_name"
                  value={formData.artist_name}
                  onChange={handleInputChange}
                  className={'input' + (errors.artist_name ? ' input-error' : '')}
                  placeholder="Enter the artist or band name"
                  disabled={loading}
                />
                {errors.artist_name && <span className="field-error">{errors.artist_name}</span>}
              </div>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="album_name" className="field-label">Album name</label>
                <input
                  type="text"
                  id="album_name"
                  name="album_name"
                  value={formData.album_name}
                  onChange={handleInputChange}
                  className="input"
                  placeholder="Enter the album name (optional)"
                  disabled={loading}
                />
              </div>

              <div className="field">
                <label htmlFor="release_year" className="field-label">Release year</label>
                <input
                  type="number"
                  id="release_year"
                  name="release_year"
                  value={formData.release_year}
                  onChange={handleInputChange}
                  className={'input' + (errors.release_year ? ' input-error' : '')}
                  placeholder="e.g. 2023"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  disabled={loading}
                />
                {errors.release_year && <span className="field-error">{errors.release_year}</span>}
              </div>
            </div>
          </div>

          {/* Optional Information Section */}
          <div className="form-card">
            <div className="form-card-title">
              <h2>Additional information</h2>
              <span className="form-tag-optional">Optional</span>
            </div>

            <div className="field">
              <label htmlFor="youtube_url" className="field-label">YouTube link</label>
              <input
                type="url"
                id="youtube_url"
                name="youtube_url"
                value={formData.youtube_url}
                onChange={handleInputChange}
                className={'input' + (errors.youtube_url ? ' input-error' : '')}
                placeholder="https://youtube.com/watch?v=..."
                disabled={loading}
              />
              {errors.youtube_url && <span className="field-error">{errors.youtube_url}</span>}
            </div>

            <div className="field">
              <label htmlFor="lyrics_excerpt" className="field-label">Key lyrics</label>
              <textarea
                id="lyrics_excerpt"
                name="lyrics_excerpt"
                value={formData.lyrics_excerpt}
                onChange={handleInputChange}
                className="textarea"
                placeholder="Share a few lines that demonstrate the vegan/animal rights theme..."
                rows="3"
                disabled={loading}
              />
            </div>

            <div className="field">
              <label htmlFor="submission_reason" className="field-label">Why should this song be included?</label>
              <textarea
                id="submission_reason"
                name="submission_reason"
                value={formData.submission_reason}
                onChange={handleInputChange}
                className="textarea"
                placeholder="Tell us why this song fits our vegan music collection..."
                rows="4"
                disabled={loading}
              />
            </div>
          </div>

          {/* Contact Information Section */}
          <div className="form-card">
            <div className="form-card-title">
              <h2>Your information</h2>
              <span className="form-tag-optional">Optional</span>
            </div>
            <p className="form-note">Leave your details if you'd like us to credit you or follow up on your submission.</p>

            <div className="form-grid-2">
              <div className="field">
                <label htmlFor="submitter_name" className="field-label">Your name</label>
                <input
                  type="text"
                  id="submitter_name"
                  name="submitter_name"
                  value={formData.submitter_name}
                  onChange={handleInputChange}
                  className="input"
                  placeholder="Your name (optional)"
                  disabled={loading}
                />
              </div>

              <div className="field">
                <label htmlFor="submitter_email" className="field-label">Your email</label>
                <input
                  type="email"
                  id="submitter_email"
                  name="submitter_email"
                  value={formData.submitter_email}
                  onChange={handleInputChange}
                  className={'input' + (errors.submitter_email ? ' input-error' : '')}
                  placeholder="your@email.com (optional)"
                  disabled={loading}
                />
                {errors.submitter_email && <span className="field-error">{errors.submitter_email}</span>}
              </div>
            </div>
          </div>

          {/* Message Display */}
          {message && (
            <div className={message.type === 'success' ? 'success-message' : 'error-message'}>
              <p>{message.text}</p>
            </div>
          )}

          {/* Submit Button */}
          <div className="form-actions">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Submitting…' : 'Submit song suggestion'}
            </button>
          </div>
        </form>

        {/* Information Sidebar */}
        <div className="submit-sidebar">
          <div className="sidebar-card">
            <h3>Submission guidelines</h3>
            <ul>
              <li><strong>Vegan themes:</strong> songs should speak to veganism, animal rights, liberation, care or connection.</li>
              <li><strong>Any genre:</strong> metal to folk, electronic to hip-hop — all genres welcome.</li>
              <li><strong>Review process:</strong> our team reviews submissions before adding them to the playlist.</li>
            </ul>
          </div>

          <div className="sidebar-card sidebar-card-moss">
            <h3>Community impact</h3>
            <p>Every submission helps build the most complete collection of vegan advocacy music.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SongSubmissionForm;