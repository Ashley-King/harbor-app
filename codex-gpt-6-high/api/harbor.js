import { loadHarbor } from "../server/live.js";
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  const data = await loadHarbor();
  return res.status(200).json(data);
}
