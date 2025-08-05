import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

function SearchResults() {
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to homepage on component mount
  useEffect(() => {
    // Preserve any search query parameters
    const searchParams = location.search;
    navigate(`/${searchParams}`, { replace: true });
  }, [navigate, location.search]);

  return (
    <div className="search-page">
      <div className="search-header">
        <h1>Redirecting to Homepage...</h1>
        <p>Search functionality has been moved to the homepage for a better experience.</p>
      </div>
    </div>
  );
}

export default SearchResults;