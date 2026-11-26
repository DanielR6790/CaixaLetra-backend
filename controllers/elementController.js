import { asyncHandler } from '../utils/asyncHandler.js';
import { listElements, syncElements } from '../services/elementService.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ elements: await listElements(req.supabase, req.params.id) });
});

export const sync = asyncHandler(async (req, res) => {
  res.json(await syncElements(req.supabase, req.user.id, req.params.id, req.body));
});