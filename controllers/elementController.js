import { asyncHandler } from '../utils/asyncHandler.js';
import { cleanupOrphanImages, listElements, syncElements } from '../services/elementService.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ elements: await listElements(req.supabase, req.params.id) });
});

export const sync = asyncHandler(async (req, res) => {
  res.json(await syncElements(req.supabase, req.user.id, req.params.id, req.body));
});

export const cleanup = asyncHandler(async (req, res) => {
  res.json(await cleanupOrphanImages(req.supabase, req.params.id, req.body?.paths));
});
