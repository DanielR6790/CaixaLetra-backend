import { asyncHandler } from '../utils/asyncHandler.js';
import { listConnections, syncConnections } from '../services/connectionService.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ connections: await listConnections(req.supabase, req.params.id) });
});

export const sync = asyncHandler(async (req, res) => {
  res.json(await syncConnections(req.supabase, req.user.id, req.params.id, req.body));
});