import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { films } from '../a24/catalog.js';

const base = new URL('../a24/', import.meta.url);
const gallery = await readFile(new URL('../glass/index.html', base), 'utf8');
const reader = gallery.match(/<dialog id="reader"[^>]*>[\s\S]*?<\/dialog>/)?.[0];
if (!reader) throw new Error('Gallery reader template missing');
const home = new URL('index.html', base);
const original = await readFile(home, 'utf8');
const template = original.replace(/<!-- shared-reader -->[\s\S]*?<!-- \/shared-reader -->/,
  () => '<!-- shared-reader -->\n  ' + reader + '\n  <!-- /shared-reader -->');
if (original === template && !template.includes(reader)) throw new Error('Films reader slot missing');
if (original !== template) await writeFile(home, template);

const pages = [['ai-films/', 'Films'], ['404/', '作品未找到']];
for (const film of films) {
  pages.push(['production/' + film.id + '/', film.name]);
  pages.push(['production/' + film.id + '/watch/', film.name]);
}

for (const [route, title] of pages) {
  const dir = new URL(route, base);
  await mkdir(dir, { recursive: true });
  const relativeBase = '../'.repeat(route.split('/').filter(Boolean).length);
  const safeTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  const page = template.replace('<base href="./">', '<base href="' + relativeBase + '">')
    .replace('<title>Kim — Films</title>', '<title>Kim — ' + safeTitle + '</title>');
  await writeFile(new URL('index.html', dir), page);
}
