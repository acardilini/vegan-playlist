import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { adminFetch } from '../../api/adminApi';

function WorkbenchStub() {
  const { id } = useParams();
  const [title, setTitle] = useState('');
  useEffect(() => {
    adminFetch(`/api/admin/workbench/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTitle(d ? d.title : `Song ${id}`))
      .catch(() => setTitle(`Song ${id}`));
  }, [id]);
  return (
    <div>
      <Link to="/admin/songs" className="btn btn-ghost btn-sm">&larr; Back to Songs</Link>
      <h1>{title || `Song ${id}`}</h1>
      <p className="admin-stub">The full Curation Workbench for this song arrives in A3.</p>
    </div>
  );
}
export default WorkbenchStub;
