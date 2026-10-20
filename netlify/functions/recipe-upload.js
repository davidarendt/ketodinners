const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const BUCKET = 'recipe-images';

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON.' }) };
  }

  const { filename, contentType, data } = body;
  if (!filename || !contentType || !data) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'filename, contentType, and data are required.' }) };
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Only JPEG, PNG, WebP, or GIF images are allowed.' }) };
  }

  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Storage not configured.' }) };
  }

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
  const objectPath = Date.now() + '-' + safeName.replace(/\.[^.]+$/, '') + '.' + ext;

  let buffer;
  try {
    buffer = Buffer.from(data, 'base64');
  } catch (_) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid image data.' }) };
  }

  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${anonKey}`,
      'apikey': anonKey,
      'Content-Type': contentType,
    },
    body: buffer,
  });

  if (!res.ok) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Upload failed.' }) };
  }

  const publicUrl = `${url}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: publicUrl }),
  };
};
