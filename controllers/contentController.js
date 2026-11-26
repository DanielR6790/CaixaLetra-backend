import { asyncHandler } from '../utils/asyncHandler.js';
import {
  listContents,
  createContent,
  updateContent,
  deleteContent,
  upsertReview,
  deleteReview,
} from '../services/contentService.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ contents: await listContents(req.supabase, req.query.category) });
});

export const create = asyncHandler(async (req, res) => {
  const content = await createContent(req.supabase, req.user.id, req.body);
  res.status(201).json({ content });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ content: await updateContent(req.supabase, req.params.id, req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  await deleteContent(req.supabase, req.params.id);
  res.status(204).end();
});

export const saveReview = asyncHandler(async (req, res) => {
  const content = await upsertReview(req.supabase, req.user.id, req.params.id, req.body);
  res.json({ content });
});

export const removeReview = asyncHandler(async (req, res) => {
  const content = await deleteReview(req.supabase, req.params.id, {
    toList: req.query.toList === 'true',
  });
  res.json({ content });
});