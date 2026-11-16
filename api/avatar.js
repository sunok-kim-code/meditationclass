// 참가자가 올린 사진으로 명상 수업용 아바타 그림을 한 장씩 그려 준다 (OpenAI 이미지 API).
// Vercel 환경 변수:
//   OPENAI_API_KEY   (필수) OpenAI API 키. 서버에만 있고 브라우저로는 나가지 않는다.
//   AVATAR_CODE      (선택) 넣어 두면 이 코드를 아는 사람만 만들 수 있다. 진행자가 참가자에게 알려 준다.
//   AVATAR_MODEL     (선택) 기본 gpt-image-1.5
//   AVATAR_QUALITY   (선택) low | medium | high, 기본 medium
// 사진과 그림은 이 서버에 저장하지 않는다. 받은 사진은 그림을 그리는 데만 쓰고 바로 버린다.
// 그림 한 장에 1분 안팎이 걸릴 수 있다 (Vercel 함수 실행 시간 기본값 300초 안에서 동작).

const STYLE = ' Style: high-quality semi-realistic 3D illustrated character with a soft, friendly look (like a modern animated film), soft even studio lighting. Fully transparent background. No ground shadow, no text, no watermark, no border.';
const SAME = ' Keep the character exactly the same as in the attached character image: same face, hairstyle, hair color, skin tone, body proportions, clothing and colors, same illustration style.';
const STEPS = {
  // 사진 → 방석에 앉은 기본 그림
  base: { use: ['photo'], size: '1024x1536', prompt: 'Create a meditation-class avatar character of the person in the attached photo. Preserve their likeness: face shape, facial features, hairstyle and hair color, skin tone, apparent age, and glasses or facial hair if present. Pose: sitting cross-legged on a round meditation cushion, facing the camera straight on, back upright, both hands resting on the knees, eyes open with a gentle calm smile, mouth closed. Clothing: comfortable plain loungewear or training wear with long sleeves and long pants in soft muted colors. The whole character including the cushion must be fully visible, centered, with a small empty margin on every side of a portrait canvas.' + STYLE },
  closed: { use: ['base'], size: '1024x1536', prompt: 'Edit the attached character image: change ONLY the eyes so that they are gently closed, as in calm meditation. Everything else (face, mouth, hair, clothing, pose, hands, cushion, and the size and position of the character in the canvas) must stay exactly identical.' + STYLE },
  talk: { use: ['base'], size: '1024x1536', prompt: 'Edit the attached character image: change ONLY the mouth so that it is open as if speaking (saying "ah", upper teeth slightly visible). The eyes stay open. Everything else (face, hair, clothing, pose, hands, cushion, and the size and position of the character in the canvas) must stay exactly identical.' + STYLE },
  pray: { use: ['base'], size: '1024x1536', prompt: 'Edit the attached character image: change ONLY the arms and hands so that both palms are pressed together in front of the chest (prayer gesture), elbows relaxed. Face, expression, hair, clothing, crossed legs, cushion, and the size and position of the character in the canvas must stay exactly identical.' + STYLE },
  high: { use: ['base'], size: '1024x1536', prompt: 'Redraw the attached character sitting cross-legged on the same cushion, but with both arms stretched straight up high above the head, symmetric, the arms passing outside the ears, palms open and facing forward. The arms and hands must not cover the face or the hair. Same calm face with eyes open and mouth closed. Draw the character smaller and anchored at the bottom of the portrait canvas so that there is generous empty space above the head and the fingertips are not cropped.' + SAME + STYLE },
  stand: { use: ['base'], size: '1024x1536', prompt: 'Draw the attached character standing upright, front view, full body from head to feet, arms relaxed at the sides, gentle calm smile, no cushion. The entire body must be visible with a small margin on a portrait canvas.' + SAME + STYLE },
  // 걷기 네 단계를 한 장에
  walk: { use: ['base', 'stand'], size: '1536x1024', prompt: 'Draw the attached character as a walk-cycle sprite sheet on a wide landscape canvas: exactly four full-body poses in a single row from left to right, each in strict side view facing RIGHT, all the same size, feet on the same baseline, no cushion. Draw the figures small enough that there is a wide empty gap between neighbouring figures: they must not touch or overlap anywhere, not even at the feet or hands. Pose 1 (contact): legs at their widest stride, front heel just touching the ground, arms swinging opposite to the legs. Pose 2 (down): front foot flat, front knee slightly bent, body at its lowest, back heel starting to lift. Pose 3 (passing): standing straight on one leg while the other leg passes beside it with a bent knee, arms close to the body. Pose 4 (up): the standing heel lifts, body at its highest, the passing leg reaching forward. No ground line, no numbers.' + SAME + STYLE },
};

const clean = (v) => (v || '').trim().replace(/^["']|["']$/g, '').trim();
function toFile(dataUrl, name) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3.2 * 1024 * 1024) return null;
  return { blob: new Blob([buf], { type: m[1] }), name: `${name}.${m[1].split('/')[1].replace('jpeg', 'jpg')}` };
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // 다른 사이트가 이 주소를 끌어다 쓰지 못하게, 같은 사이트에서 온 요청만 받는다
  const host = req.headers.host || '', from = req.headers.origin || req.headers.referer || '';
  let same = false; try { same = !!from && new URL(from).host === host; } catch (e) { same = false; }
  const key = clean(process.env.OPENAI_API_KEY), code = clean(process.env.AVATAR_CODE);
  if (req.method !== 'POST') { res.status(200).json({ configured: !!key, needCode: !!code, steps: Object.keys(STEPS) }); return; }
  if (!same) { res.status(403).json({ error: 'forbidden' }); return; }
  if (!key) { res.status(503).json({ error: 'not_configured' }); return; }
  let body = req.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object') { res.status(400).json({ error: 'bad_request' }); return; }
  if (code && clean(String(body.code || '')) !== code) { res.status(401).json({ error: 'bad_code' }); return; }
  const step = STEPS[body.step];
  if (!step) { res.status(400).json({ error: 'bad_step' }); return; }
  const files = step.use.map((k) => toFile(body[k], k));
  if (!files[0]) { res.status(400).json({ error: 'bad_image' }); return; }
  const model = clean(process.env.AVATAR_MODEL) || 'gpt-image-1.5';
  const quality = ['low', 'medium', 'high'].includes(clean(process.env.AVATAR_QUALITY)) ? clean(process.env.AVATAR_QUALITY) : 'medium';
  const form = new FormData();
  form.append('model', model); form.append('prompt', step.prompt); form.append('size', step.size); form.append('n', '1');
  form.append('quality', quality); form.append('background', 'transparent'); form.append('output_format', 'webp'); form.append('output_compression', '78');
  if (/^gpt-image-1(\.5)?$/.test(model)) form.append('input_fidelity', 'high'); // 얼굴 닮게 (이 값을 받지 않는 모델에는 보내지 않는다)
  for (const f of files) if (f) form.append('image[]', f.blob, f.name);
  try {
    const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    const j = await r.json().catch(() => null);
    const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
    if (!r.ok || !b64) {
      // 원인만 알려 준다 (키는 내보내지 않는다)
      const e = (j && j.error) || {};
      res.status(r.status === 429 ? 429 : 502).json({ error: 'openai', status: r.status, code: e.code || e.type || null, message: String(e.message || '').replace(/sk-[A-Za-z0-9_-]+/g, 'sk-…').slice(0, 300) });
      return;
    }
    res.status(200).json({ image: `data:image/webp;base64,${b64}` });
  } catch (e) { res.status(502).json({ error: 'network', message: String((e && e.message) || e).slice(0, 200) }); }
}
module.exports = handler;
module.exports.STEPS = STEPS;
