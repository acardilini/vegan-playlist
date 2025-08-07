import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line, Doughnut } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

function DataDashboard() {
  const [summary, setSummary] = useState(null);
  const [yearData, setYearData] = useState([]);
  const [genreData, setGenreData] = useState([]);
  const [audioFeatures, setAudioFeatures] = useState([]);
  const [veganThemes, setVeganThemes] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  
  // Filter states
  const [filters, setFilters] = useState({
    genre: '',
    parent_genre: '',
    vegan_focus: '',
    advocacy_style: '',
    min_year: '',
    max_year: '',
    audio_feature: 'energy'
  });
  
  const [loading, setLoading] = useState(false);

  // Load dashboard data
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const filterParams = new URLSearchParams();
      
      // Add non-empty filters to params
      Object.entries(filters).forEach(([key, value]) => {
        if (value && key !== 'audio_feature') {
          filterParams.append(key, value);
        }
      });

      const [summaryRes, yearRes, genreRes, audioRes, themesRes] = await Promise.all([
        fetch('http://localhost:5000/api/analytics/summary'),
        fetch(`http://localhost:5000/api/analytics/year-distribution?${filterParams}`),
        fetch(`http://localhost:5000/api/analytics/genre-distribution?${filterParams}&limit=15`),
        fetch(`http://localhost:5000/api/analytics/audio-features?${filterParams}&feature=${filters.audio_feature}`),
        fetch(`http://localhost:5000/api/analytics/vegan-themes?${filterParams}`)
      ]);

      const summaryData = await summaryRes.json();
      const yearDataRes = await yearRes.json();
      const genreDataRes = await genreRes.json();
      const audioDataRes = await audioRes.json();
      const themesDataRes = await themesRes.json();
      
      setSummary(summaryData.error ? null : summaryData);
      setYearData(yearDataRes.error ? [] : yearDataRes);
      setGenreData(genreDataRes.error ? [] : genreDataRes);
      setAudioFeatures(audioDataRes.error ? [] : audioDataRes);
      setVeganThemes(themesDataRes.error ? [] : themesDataRes);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load filter options
  const loadFilterOptions = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/analytics/filter-options');
      const options = await response.json();
      setFilterOptions(options);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [filters]);

  // Chart configurations
  const yearChartData = {
    labels: (yearData || []).map(item => item.year),
    datasets: [
      {
        label: 'Songs Released',
        data: (yearData || []).map(item => parseInt(item.song_count)),
        backgroundColor: 'rgba(75, 192, 192, 0.6)',
        borderColor: 'rgba(75, 192, 192, 1)',
        borderWidth: 2,
        fill: false,
      }
    ]
  };

  const genreChartData = {
    labels: (genreData || []).map(item => item.genre),
    datasets: [
      {
        label: 'Number of Songs',
        data: (genreData || []).map(item => parseInt(item.song_count)),
        backgroundColor: [
          'rgba(255, 99, 132, 0.6)',
          'rgba(54, 162, 235, 0.6)',
          'rgba(255, 205, 86, 0.6)',
          'rgba(75, 192, 192, 0.6)',
          'rgba(153, 102, 255, 0.6)',
          'rgba(255, 159, 64, 0.6)',
          'rgba(199, 199, 199, 0.6)',
          'rgba(83, 102, 255, 0.6)',
          'rgba(255, 99, 255, 0.6)',
          'rgba(99, 255, 132, 0.6)',
          'rgba(255, 132, 99, 0.6)',
          'rgba(132, 99, 255, 0.6)',
          'rgba(99, 255, 255, 0.6)',
          'rgba(255, 255, 99, 0.6)',
          'rgba(192, 75, 192, 0.6)'
        ],
      }
    ]
  };

  const audioFeaturesChartData = {
    labels: (audioFeatures || []).map(item => item.feature_level),
    datasets: [
      {
        data: (audioFeatures || []).map(item => parseInt(item.song_count)),
        backgroundColor: [
          'rgba(255, 99, 132, 0.8)',
          'rgba(255, 159, 64, 0.8)',
          'rgba(255, 205, 86, 0.8)',
          'rgba(75, 192, 192, 0.8)',
          'rgba(153, 102, 255, 0.8)'
        ],
      }
    ]
  };

  const veganThemesChartData = {
    labels: (veganThemes || []).map(item => item.theme),
    datasets: [
      {
        label: 'Songs with Theme',
        data: (veganThemes || []).map(item => parseInt(item.song_count)),
        backgroundColor: 'rgba(34, 197, 94, 0.6)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          precision: 0
        }
      }
    }
  };

  const doughnutOptions = {
    responsive: true,
    plugins: {
      legend: {
        position: 'right',
      },
    },
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const clearFilters = () => {
    setFilters({
      genre: '',
      parent_genre: '',
      vegan_focus: '',
      advocacy_style: '',
      min_year: '',
      max_year: '',
      audio_feature: 'energy'
    });
  };

  if (loading && !summary) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Loading dashboard...</p>
      </div>
    );
  }

  return (
    <div className="data-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <h1>Vegan Music Analytics Dashboard</h1>
        <p>Explore patterns and trends in our curated collection of vegan-themed music</p>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="dashboard-summary">
          <div className="stat-card">
            <h3>{summary.total_songs.toLocaleString()}</h3>
            <p>Total Songs</p>
          </div>
          <div className="stat-card">
            <h3>{summary.total_genres}</h3>
            <p>Unique Genres</p>
          </div>
          <div className="stat-card">
            <h3>{summary.year_range.earliest} - {summary.year_range.latest}</h3>
            <p>Year Range</p>
          </div>
          <div className="stat-card">
            <h3>{summary.songs_with_themes}</h3>
            <p>Themed Songs</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="dashboard-filters">
        <h2>Filters</h2>
        <div className="filter-grid">
          <div className="filter-group">
            <label>Genre:</label>
            <select 
              value={filters.genre} 
              onChange={(e) => handleFilterChange('genre', e.target.value)}
            >
              <option value="">All Genres</option>
              {filterOptions.genres?.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Parent Genre:</label>
            <select 
              value={filters.parent_genre} 
              onChange={(e) => handleFilterChange('parent_genre', e.target.value)}
            >
              <option value="">All Parent Genres</option>
              {filterOptions.parent_genres?.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Min Year:</label>
            <input 
              type="number" 
              value={filters.min_year}
              onChange={(e) => handleFilterChange('min_year', e.target.value)}
              placeholder="1970"
              min="1900"
              max="2025"
            />
          </div>

          <div className="filter-group">
            <label>Max Year:</label>
            <input 
              type="number" 
              value={filters.max_year}
              onChange={(e) => handleFilterChange('max_year', e.target.value)}
              placeholder="2025"
              min="1900"
              max="2025"
            />
          </div>

          <div className="filter-group">
            <label>Vegan Theme:</label>
            <select 
              value={filters.vegan_focus} 
              onChange={(e) => handleFilterChange('vegan_focus', e.target.value)}
            >
              <option value="">All Themes</option>
              {filterOptions.vegan_themes?.map(theme => (
                <option key={theme} value={theme}>{theme}</option>
              ))}
            </select>
          </div>

          <div className="filter-group">
            <label>Audio Feature:</label>
            <select 
              value={filters.audio_feature} 
              onChange={(e) => handleFilterChange('audio_feature', e.target.value)}
            >
              <option value="energy">Energy</option>
              <option value="danceability">Danceability</option>
              <option value="valence">Valence (Mood)</option>
            </select>
          </div>

          <div className="filter-group">
            <button onClick={clearFilters} className="btn-secondary">
              Clear All Filters
            </button>
          </div>
        </div>
      </div>

      {loading && (
        <div className="dashboard-loading-overlay">
          <div className="loading-spinner"></div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="charts-grid">
        {/* Year Distribution */}
        <div className="chart-container">
          <h2>Songs Released Over Time</h2>
          {yearData.length > 0 ? (
            <Line data={yearChartData} options={chartOptions} />
          ) : (
            <div className="no-data">No data available for the selected filters</div>
          )}
        </div>

        {/* Genre Distribution */}
        <div className="chart-container">
          <h2>Genre Distribution</h2>
          {genreData.length > 0 ? (
            <Bar data={genreChartData} options={chartOptions} />
          ) : (
            <div className="no-data">No data available for the selected filters</div>
          )}
        </div>

        {/* Audio Features */}
        <div className="chart-container">
          <h2>{filters.audio_feature.charAt(0).toUpperCase() + filters.audio_feature.slice(1)} Distribution</h2>
          {audioFeatures.length > 0 ? (
            <Doughnut data={audioFeaturesChartData} options={doughnutOptions} />
          ) : (
            <div className="no-data">No data available for the selected filters</div>
          )}
        </div>

        {/* Vegan Themes */}
        <div className="chart-container">
          <h2>Vegan Themes</h2>
          {veganThemes.length > 0 ? (
            <Bar data={veganThemesChartData} options={chartOptions} />
          ) : (
            <div className="no-data">No themed songs found for the selected filters</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DataDashboard;