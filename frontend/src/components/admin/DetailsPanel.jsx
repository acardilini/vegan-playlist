import { useState } from 'react';
import { AutoText, SaveTag } from './SavedField';

function coverUrl(images) {
  if (!images) return null;
  let arr = images;
  if (typeof images === 'string') { try { arr = JSON.parse(images); } catch { return null; } }
  return Array.isArray(arr) && arr[0] && arr[0].url ? arr[0].url : null;
}

function DetailsPanel({ wb, savePanel }) {
  const artistNames = (wb.artists || []).map((a) => a.name).join(', ') || '—';
  const cover = coverUrl(wb.album && wb.album.images);
  const [langSave, setLangSave] = useState('idle');

  const setEnglish = async () => {
    setLangSave('saving');
    const res = await savePanel('details', { language: 'English' });
    setLangSave(res && res.ok ? 'saved' : 'error');
  };

  return (
    <section className="wb-panel">
      <h2>Details</h2>
      <AutoText label="Title" initial={wb.title} onSave={(v) => savePanel('details', { title: v })} />
      <div className="wb-lang">
        <AutoText label="Language sung in" initial={wb.language} placeholder="e.g. English"
          onSave={(v) => savePanel('details', { language: v })} />
        {wb.language !== 'English' && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={setEnglish}>Set English</button>
        )}
        <SaveTag status={langSave} />
      </div>
      <div className="wb-readonly">
        <div><span className="k">Artist(s)</span>{artistNames}</div>
        <div><span className="k">Album</span>{(wb.album && wb.album.name) || '—'}</div>
        <div><span className="k">Released</span>{(wb.album && wb.album.release_date) || '—'}</div>
        <div><span className="k">Spotify id</span>{wb.spotify_id || '—'}</div>
      </div>
      <div className="wb-cover">
        {cover ? <img src={cover} alt="" className="wb-cover-img" /> : <span className="wb-cover-ph" />}
        <AutoText label="Cover image URL (paste)" initial={cover || ''} placeholder="https://…"
          onSave={(v) => savePanel('cover', { cover_url: v })} />
      </div>
    </section>
  );
}
export default DetailsPanel;
