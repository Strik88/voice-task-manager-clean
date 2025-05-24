export default async function handler(req, res) {
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version');
if (req.method === 'OPTIONS') return res.status(200).end();
const { endpoint } = req.query;
if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });
const authHeader = req.headers.authorization;
if (!authHeader) return res.status(401).json({ error: 'Missing auth' });
const notionResponse = await fetch(\https://api.notion.com/v1/\\, { method: req.method, headers: { Authorization: authHeader, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }, body: req.body ? JSON.stringify(req.body) : undefined });
const data = await notionResponse.json();
return res.status(notionResponse.status).json(data);
}