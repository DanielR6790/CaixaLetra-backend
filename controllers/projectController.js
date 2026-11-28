import { asyncHandler } from '../utils/asyncHandler.js';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from '../services/projectService.js';
import { duplicateProject } from '../services/duplicateService.js';

export const list = asyncHandler(async (req, res) => {
  res.json({ projects: await listProjects(req.supabase) });
});

export const get = asyncHandler(async (req, res) => {
  res.json({ project: await getProject(req.supabase, req.params.id) });
});

export const create = asyncHandler(async (req, res) => {
  const project = await createProject(req.supabase, req.user.id, req.body);
  res.status(201).json({ project });
});

export const update = asyncHandler(async (req, res) => {
  res.json({ project: await updateProject(req.supabase, req.params.id, req.body) });
});

export const remove = asyncHandler(async (req, res) => {
  await deleteProject(req.supabase, req.params.id);
  res.status(204).end();
});

export const duplicate = asyncHandler(async (req, res) => {
  const project = await duplicateProject(req.supabase, req.user.id, req.params.id);
  res.status(201).json({ project });
});
