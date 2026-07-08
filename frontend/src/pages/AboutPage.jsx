function AboutPage() {
  return (
    <div className="page-container">
      <div className="about-content">
        <div className="about-header">
          <h1>About The Vegan Playlist</h1>
          <p className="about-subtitle">
            7 years of curating music that advocates for animals, the environment, and compassionate living
          </p>
        </div>

        <div className="about-sections">
          <section className="about-section">
            <h2>Our Mission</h2>
            <p>
              The Vegan Playlist is a comprehensive database of songs with vegan, animal rights,
              and animal liberation themes. We believe music has the power to inspire change and
              raise awareness about the treatment of animals and environmental issues.
            </p>
          </section>

          <section className="about-section">
            <h2>What We Include</h2>
            <p>
              Our collection spans multiple genres and decades, featuring songs that:
            </p>
            <ul>
              <li>Directly advocate for animal rights and liberation</li>
              <li>Promote plant-based living and veganism</li>
              <li>Address environmental issues related to animal agriculture</li>
              <li>Share stories of compassion and empathy for animals</li>
              <li>Critique factory farming and animal exploitation</li>
            </ul>
          </section>

          <section className="about-section">
            <h2>Our Approach</h2>
            <p>
              Each song in our database is carefully analyzed and categorized by:
            </p>
            <ul>
              <li><strong>Advocacy Style:</strong> Direct, educational, subtle, or storytelling</li>
              <li><strong>Animal Focus:</strong> All animals, farm animals, or specific species</li>
              <li><strong>Themes:</strong> Animal rights, environment, health, ethics</li>
              <li><strong>Musical Genre:</strong> Rock, hip hop, punk, electronic, and more</li>
            </ul>
          </section>

          <section className="about-section">
            <h2>Get Involved</h2>
            <p>
              We welcome song suggestions from the community! If you know of a song with
              vegan or animal rights themes that we haven't included, please let us know.
              Together, we can build the most comprehensive collection of advocacy music.
            </p>
          </section>

          <div className="about-stats">
            <div className="stat-highlight">
              <span className="stat-number">650+</span>
              <span className="stat-label">Songs Curated</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">7</span>
              <span className="stat-label">Years of Research</span>
            </div>
            <div className="stat-highlight">
              <span className="stat-number">200+</span>
              <span className="stat-label">Artists Featured</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
