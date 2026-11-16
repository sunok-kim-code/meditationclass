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
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!id || !token) { res.status(200).json({ configured: false }); return; }
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 21600 }), // 6시간: 수업 한 번에 충분
    });
    if (!r.ok) { res.status(200).json({ configured: false, error: `turn ${r.status}` }); return; }
    const data = await r.json();
    let list = data.iceServers;
    if (list && !Array.isArray(list)) list = [list];
    // 53번 포트 주소는 일부 브라우저에서 막혀 연결이 늦어지므로 뺀다
    list = (list || []).map((s) => ({ ...s, urls: [].concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u)) })).filter((s) => s.urls.length);
    res.status(200).json({ configured: list.some((s) => s.urls.some((u) => u.startsWith('turn'))), iceServers: list });
  } catch (e) {
    res.status(200).json({ configured: false, error: 'turn fetch failed' });
  }
};
