// The body "Clear lyrics" sends to PUT /api/admin/workbench/:id/lyrics. It also resets the lyrics status and source link,
// which would otherwise keep pointing at the scraped page the junk came from. Shared by the Junk lyrics queue and the
// workbench banner so the two can never disagree.
export const CLEAR_LYRICS_BODY = { lyrics: '', lyrics_status: 'not_searched', lyrics_url: '' };
