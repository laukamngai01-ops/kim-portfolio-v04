// Center and optional crop scale within the original still. The portrait
// video covers keep burned-in captions outside the feather and faces clear
// of the spindle. The film reader retains the original full frame.
const focalPoints = {
  'motorsport:0': [.40, .53],
  'videography:0': [.59, .37, .82],
  'videography:1': [.50, .423],
  'videography:2': [.57, .435, .88],
  'videography:3': [.585, .382, .83],
  'ai-film:0': [.60, .49],
  'ai-film:1': [.51, .47],
  'ai-film:2': [.55, .48],
};

export function drawVinylPrint(canvas, photo, entry) {
  if (!photo?.naturalWidth || !photo.naturalHeight) return;
  const ctx = canvas.getContext('2d');
  const width = photo.naturalWidth, height = photo.naturalHeight;
  const [x, y, cropScale = 1] = focalPoints[entry.key] || [.5, .5];
  const crop = Math.min(width, height) * cropScale;
  const left = Math.max(0, Math.min(width - crop, x * width - crop / 2));
  const top = Math.max(0, Math.min(height - crop, y * height - crop / 2));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, left, top, crop, crop, 0, 0, canvas.width, canvas.height);
}
