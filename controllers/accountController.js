import { asyncHandler } from '../utils/asyncHandler.js';
import { deleteAccount, exportAccountData } from '../services/accountService.js';

export const exportData = asyncHandler(async (req, res) => {
  res.json(await exportAccountData(req.supabase, req.user));
});

export const remove = asyncHandler(async (req, res) => {
  await deleteAccount(req.supabase, req.user, req.body.password);
  res.status(204).end();
});