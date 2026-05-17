import { getHistory } from '../../lib/db';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).end();
  }

  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: '缺少 id' });
  }

  try {
    const history = await getHistory(id, 60);
    return res.status(200).json({ history });
  } catch (error) {
    return res.status(500).json({ history: [], error: error.message });
  }
}
