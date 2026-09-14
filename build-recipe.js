// /api/build-recipe.js — Vercel serverless function.
// Turns a casual recipe description into a structured recipe card
// via the Vercel AI Gateway (Claude Haiku). Needs AI_GATEWAY_API_KEY.

const SYSTEM_PROMPT = `You turn a casual, conversational description of a family recipe into a clean recipe card.
Return ONLY valid JSON — no markdown, no commentary — with exactly these keys:
{
  "title": "short recipe title",
  "ingredients": ["one ingredient per item, quantities included", "..."],
  "steps": ["one clear step per item, in cooking order", "..."],
  "servings": "e.g. Serves 6 (or null if not mentioned)",
  "prep": "e.g. 20 minutes (or null if not mentioned)",
  "cook": "e.g. 1 hour (or null if not mentioned)",
  "notes": "the story, tips, or substitutions in one short paragraph (or null)"
}
Rules:
- Fix spelling, punctuation, and capitalization.
- Split run-on ingredient lists into separate items; keep quantities with each ingredient.
- Split run-on directions into ordered single-action steps.
- Never invent ingredients, steps, times, or temperatures the person did not mention.
- If no title is stated, make a short sensible one from the dish.
- Keep values factual and plain; no flowery language.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'The AI helper is not set up yet.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const text = String((body && body.text) || '').slice(0, 3000).trim();
  if (text.length < 10) {
    res.status(400).json({ error: 'Please describe the recipe a little first.' });
    return;
  }
  // Light abuse guard: only accept calls that come from the cookbook site itself.
  const referer = String(req.headers.referer || req.headers.referrer || '');
  const siteHost = process.env.SITE_HOST || 'porretta-family-cookbook.vercel.app';
  if (referer && referer.indexOf(siteHost) === -1 && referer.indexOf('localhost') === -1) {
    res.status(403).json({ error: 'Not allowed.' });
    return;
  }
  try {
    const gw = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4.5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 1600
      })
    });
    if (!gw.ok) throw new Error('AI gateway error ' + gw.status);
    const data = await gw.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    let recipe;
    try { recipe = JSON.parse(content); }
    catch (e) { throw new Error('The AI helper returned something odd.'); }
    const strList = (v, maxLen, maxItems) =>
      (Array.isArray(v) ? v : []).map(s => String(s).slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
    const strOrNull = (v, maxLen) => (v ? String(v).slice(0, maxLen) : null);
    res.status(200).json({
      title: strOrNull(recipe.title, 120),
      ingredients: strList(recipe.ingredients, 200, 60),
      steps: strList(recipe.steps, 500, 40),
      servings: strOrNull(recipe.servings, 60),
      prep: strOrNull(recipe.prep, 60),
      cook: strOrNull(recipe.cook, 60),
      notes: strOrNull(recipe.notes, 1000)
    });
  } catch (err) {
    res.status(502).json({ error: 'The AI helper had trouble — please try again.' });
  }
};
