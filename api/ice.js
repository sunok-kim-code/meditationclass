// 기기끼리 직접 연결이 안 될 때(서로 다른 통신망, 회사·학교 방화벽 등) 거쳐 갈 중계(TURN) 서버 정보를 내려준다.
// Cloudflare Realtime TURN 키를 Vercel 환경 변수에 넣어 두면 동작한다. 키는 서버에만 있고 브라우저로는 나가지 않는다.
//   CF_TURN_KEY_ID      TURN 키 ID
//   CF_TURN_API_TOKEN   TURN 키 API 토큰
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // 다른 사이트가 이 주소를 끌어다 쓰지 못하게, 같은 사이트에서 온 요청만 받는다
  const host = req.headers.host || '';
  const from = req.headers.origin || req.headers.referer || '';
  if (from) {
    let ok = false;
    try { ok = new URL(from).host === host; } catch (e) { ok = false; }
    if (!ok) { res.status(403).json({ configured: false, error: 'forbidden' }); return; }
  }
  // 붙여 넣을 때 섞여 들어온 공백·따옴표는 걷어낸다
  const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim();
  const id = clean(process.env.CF_TURN_KEY_ID), token = clean(process.env.CF_TURN_API_TOKEN);
  if (!id || !token) { res.status(200).json({ configured: false, missing: [!id && 'CF_TURN_KEY_ID', !token && 'CF_TURN_API_TOKEN'].filter(Boolean) }); return; }
  const ask = (keyId, apiToken) => fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 21600 }), // 6시간: 수업 한 번에 충분
  });
  try {
    let r = await ask(id, token), swapped = false;
    if (!r.ok) { const r2 = await ask(token, id); if (r2.ok) { r = r2; swapped = true; } } // 두 값을 서로 바꿔 넣은 경우도 받아 준다
    if (!r.ok) {
      // 원인을 짐작할 수 있게 값의 모양만 알려 준다 (값 자체는 내보내지 않는다)
      const shape = (v) => ({ length: v.length, hex: /^[0-9a-f]+$/i.test(v) });
      res.status(200).json({ configured: false, error: `turn ${r.status}`, keyId: shape(id), apiToken: shape(token) });
      return;
    }
    const data = await r.json();
    let list = data.iceServers;
    if (list && !Array.isArray(list)) list = [list];
    // 53번 포트 주소는 일부 브라우저에서 막혀 연결이 늦어지므로 뺀다
    list = (list || []).map((s) => ({ ...s, urls: [].concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
    res.status(200).json({ configured: list.some((s) => s.urls.some((u) => u.startsWith('turn'))), swapped, iceServers: list });
  } catch (e) {
    res.status(200).json({ configured: false, error: 'turn fetch failed' });
  }
};
