import { asyncHandler } from '../utils/asyncHandler.js';
import { searchContent, getContentDetails } from '../services/searchService.js';

export const search = asyncHandler(async (req, res) => {
  const { q, category } = req.query;
  res.json(await searchContent({ query: q, category }));
});

export const details = asyncHandler(async (req, res) => {
  const { category, id } = req.query;
  res.json({ item: await getContentDetails({ category, id }) });
});