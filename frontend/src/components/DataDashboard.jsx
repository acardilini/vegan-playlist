import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

// Chart.js can't read CSS custom properties directly — resolve brand tokens at render time.
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function DataDashboard() {
  const [summary, setSummary] = useState(null);
  const [yearData, setYearData] = useState([]);
  const [genreData, setGenreData] = useState([]);
  const [veganThemes, setVeganThemes] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});

  // Filter states
  const [filters, setFilters] = useState({
    genre: '',
    parent_genre: '',
    vegan_focus: '',
    advocacy_style: '',
    min_year: '',
    max_year: ''
  });

  const [loading, setLoading] = useState(false);

  // Load dashboard data
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      const filterParams = new URLSearchParams();

      // Add non-empty filters to params
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          filterParams.append(key, value);
        }
      });

      const [summaryRes, yearRes, genreRes, themesRes] = await Promise.all([
        fetch('http://localhost:5000/api/analytics/summary'),
        fetch(`http://localhost:5000/api/analytics/year-distribution?${filterParams}`),
        fetch(`http://localhost:5000/api/analytics/genre-distribution?${filterParams}&limit=15`),
        fetch(`http://localhost:5000/api/analytics/vegan-themes?${filterParams}`)
      ]);

      const summaryData = await summaryRes.json();
      const yearDataRes = await yearRes.json();
      const genreDataRes = await genreRes.json();
      const themesDataRes = await themesRes.json();

      setSummary(summaryData.error ? null : summaryData);
      setYearData(yearDataRes.error ? [] : yearDataRes);
      setGenreData(genreDataRes.error ? [] : genreDataRes);
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

  // Chart configurations — single-hue brand tokens, no rainbow (see dataviz skill)
  const yearChartData = {
    labels: (yearData || []).map(item => item.year),
    datasets: [
      {
        label: 'Songs Released',
        data: (yearData || []).map(item => parseInt(item.song_count)),
        borderColor: cssVar('--accent-ember-60'),
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 2,
        tension: 0.3,
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
        backgroundColor: cssVar('--accent-moss-60'),
        borderWidth: 0,
      }
    ]
  };

  const veganThemesChartData = {
    labels: (veganThemes || []).map(item => item.theme),
    datasets: [
      {
        label: 'Songs with Theme',
        data: (veganThemes || []).map(item => parseInt(item.song_count)),
        backgroundColor: cssVar('--accent-moss-60'),
        borderWidth: 0,
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: cssVar('--text-muted'), font: { family: 'Public Sans' } },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { precision: 0, color: cssVar('--text-muted'), font: { family: 'Public Sans' } },
        grid: { color: cssVar('--border-hairline') },
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
      max_year: ''
    });
  };

  if (loading && !summary) {
    return (
      <div className="page-container">
        <div className="loading-message">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Vegan music analytics</h1>
        <p>Explore patterns and trends across the collection.</p>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="dashboard-stats">
          <div className="stat-badge">
            <span className="stat-value">{summary.total_songs.toLocaleString()}</span>
            <span className="stat-label">Total songs</span>
          </div>
          <div className="stat-badge">
            <span className="stat-value">{summary.total_genres}</span>
            <span className="stat-label">Unique genres</span>
          </div>
          <div className="stat-badge">
            <span className="stat-value">{summary.year_range.earliest} - {summary.year_range.latest}</span>
            <span className="stat-label">Year range</span>
          </div>
          <div className="stat-badge">
            <span className="stat-value">{summary.songs_with_themes}</span>
            <span className="stat-label">Themed songs</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="form-card">
        <div className="form-card-title">
          <h2>Filters</h2>
          <button onClick={clearFilters} className="btn btn-ghost btn-sm">
            Clear all filters
          </button>
        </div>
        <div className="dashboard-filter-grid">
          <div className="field">
            <label className="field-label" htmlFor="dash-genre">Genre</label>
            <select
              id="dash-genre"
              className="select"
              value={filters.genre}
              onChange={(e) => handleFilterChange('genre', e.target.value)}
            >
              <option value="">All genres</option>
              {filterOptions.genres?.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="dash-parent-genre">Parent genre</label>
            <select
              id="dash-parent-genre"
              className="select"
              value={filters.parent_genre}
              onChange={(e) => handleFilterChange('parent_genre', e.target.value)}
            >
              <option value="">All parent genres</option>
              {filterOptions.parent_genres?.map(genre => (
                <option key={genre} value={genre}>{genre}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="dash-theme">Vegan theme</label>
            <select
              id="dash-theme"
              className="select"
              value={filters.vegan_focus}
              onChange={(e) => handleFilterChange('vegan_focus', e.target.value)}
            >
              <option value="">All themes</option>
              {filterOptions.vegan_themes?.map(theme => (
                <option key={theme} value={theme}>{theme}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="dash-min-year">Min year</label>
            <input
              id="dash-min-year"
              type="number"
              className="input"
              value={filters.min_year}
              onChange={(e) => handleFilterChange('min_year', e.target.value)}
              placeholder="1970"
              min="1900"
              max="2025"
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="dash-max-year">Max year</label>
            <input
              id="dash-max-year"
              type="number"
              className="input"
              value={filters.max_year}
              onChange={(e) => handleFilterChange('max_year', e.target.value)}
              placeholder="2025"
              min="1900"
              max="2025"
            />
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="charts-grid">
        {/* Year Distribution */}
        <div className="chart-panel">
          <h2>Songs released over time</h2>
          {yearData.length > 0 ? (
            <Line data={yearChartData} options={chartOptions} />
          ) : (
            <div className="no-results"><p>No data available for the selected filters</p></div>
          )}
        </div>

        {/* Genre Distribution */}
        <div className="chart-panel">
          <h2>Genre distribution</h2>
          {genreData.length > 0 ? (
            <Bar data={genreChartData} options={chartOptions} />
          ) : (
            <div className="no-results"><p>No data available for the selected filters</p></div>
          )}
        </div>

        {/* Vegan Themes */}
        <div className="chart-panel">
          <h2>Vegan themes</h2>
          {veganThemes.length > 0 ? (
            <Bar data={veganThemesChartData} options={chartOptions} />
          ) : (
            <div className="no-results"><p>No themed songs found for the selected filters</p></div>
          )}
        </div>
      </div>
    </div>
  );
}

export default DataDashboard;
