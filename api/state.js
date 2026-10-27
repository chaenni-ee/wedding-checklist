// 결혼 준비 데이터 저장 API: 비공개 Vercel Blob 파일 하나에 전체 데이터를 JSON으로 보관
import { BlobNotFoundError, get, head, put } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';

const PATH = 'wedding/state.json';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// 비밀번호(PASSCODE 환경 변수) 비교
function authorized(key) {
  const secret = process.env.PASSCODE;
  if (!secret || typeof key !== 'string') return false;
  const hash = (v) => createHash('sha256').update(v).digest();
  return timingSafeEqual(hash(key), hash(secret));
}

// version은 Blob의 ETag. 아직 저장된 적 없으면 빈 문자열
// get()은 HTTP 헤더의 ETag(W/"..." 처럼 감싸져 올 수 있음)를, put()·head()는 API 응답의 ETag를 주므로
// 따옴표와 W/를 떼어낸 같은 모양으로 맞춰서 비교
function normEtag(etag) {
  return String(etag || '').replace(/^W\//, '').replace(/"/g, '');
}

async function readState() {
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { version: '', data: null };
  const text = await new Response(result.stream).text();
  return { version: normEtag(result.blob.etag), data: JSON.parse(text) };
}

// 지금 저장된 파일의 ETag (put의 ifMatch에 그대로 넘길 수 있는 모양). 파일이 없으면 null
async function currentEtag() {
  try {
    return (await head(PATH)).etag;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }
  if (!authorized(body.key)) return json({ ok: false, error: 'unauthorized' }, 401);

  if (body.action === 'get') {
    return json({ ok: true, ...(await readState()) });
  }

  if (body.action === 'save') {
    if (!body.data || typeof body.data !== 'object') return json({ ok: false, error: 'bad_request' }, 400);
    const base = typeof body.baseVersion === 'string' ? normEtag(body.baseVersion) : '';
    const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false };
    try {
      // 다른 기기에서 먼저 저장했으면 덮어쓰지 않음 (처음 저장할 땐 파일이 없을 때만)
      const etag = await currentEtag();
      if (normEtag(etag) !== base) return json({ ok: false, error: 'conflict', ...(await readState()) }, 409);
      // 확인과 저장 사이에 다른 기기가 끼어드는 경우는 ifMatch가 막아줌
      if (etag) options.ifMatch = etag;
      else options.allowOverwrite = false;
      const saved = await put(PATH, JSON.stringify(body.data), options);
      return json({ ok: true, version: normEtag(saved.etag) });
    } catch (err) {
      const current = await readState();
      if (current.version !== base) return json({ ok: false, error: 'conflict', ...current }, 409);
      console.error(err);
      return json({ ok: false, error: 'save_failed' }, 500);
    }
  }

  return json({ ok: false, error: 'bad_request' }, 400);
}
