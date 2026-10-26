// 결혼 준비 데이터 저장 API: 비공개 Vercel Blob 파일 하나에 전체 데이터를 JSON으로 보관
import { get, put } from '@vercel/blob';
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
async function readState() {
  const result = await get(PATH, { access: 'private', useCache: false });
  if (!result || result.statusCode !== 200) return { version: '', data: null };
  const text = await new Response(result.stream).text();
  return { version: result.blob.etag, data: JSON.parse(text) };
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
    const base = typeof body.baseVersion === 'string' ? body.baseVersion : '';
    const options = { access: 'private', contentType: 'application/json', addRandomSuffix: false };
    // 다른 기기에서 먼저 저장했으면 덮어쓰지 않음 (처음 저장할 땐 파일이 없을 때만)
    if (base) options.ifMatch = base;
    else options.allowOverwrite = false;
    try {
      const saved = await put(PATH, JSON.stringify(body.data), options);
      return json({ ok: true, version: saved.etag });
    } catch (err) {
      const current = await readState();
      if (current.version !== base) return json({ ok: false, error: 'conflict', ...current }, 409);
      console.error(err);
      return json({ ok: false, error: 'save_failed' }, 500);
    }
  }

  return json({ ok: false, error: 'bad_request' }, 400);
}
