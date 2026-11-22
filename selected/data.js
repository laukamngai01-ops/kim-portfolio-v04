import { projects as source } from '../data.js';

// Only the existing, provenance-mapped V04 media is used. Research assets stay outside this app.
const mediaURL = value => value ? new URL(value, new URL('../', import.meta.url)).href : value;
export const projects = source.map(project => ({
  ...project,
  cover: mediaURL(project.cover),
  items: project.items.map(item => ({ ...item, image: mediaURL(item.image), small: mediaURL(item.small), src: mediaURL(item.src) })),
}));
export const items = projects.flatMap(project => project.items.map((item, index) => ({
  key: `${project.id}:${index}`, projectId: project.id, index, project, item,
})));
