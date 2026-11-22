// Scale samples of the returning primary and adjacent discs in the reference
// browser. Coordinates in this timeline are elapsed milliseconds, not frames.
const mainReturn = [[0,0],[435,0],[500,.117],[600,.429],[700,.756],[800,.877],[950,.948],[1150,.985],[1460,1]];
const sideReturn = [[0,0],[563,0],[650,.124],[700,.371],[750,.675],[800,.829],[900,.935],[1050,.985],[1250,1]];
const pressed = [[0,1],[95,.94],[140,.943],[220,1.01],[285,1.016],[370,1.014],[490,1.002],[600,1]];
const clamp01 = n => Math.max(0, Math.min(1, n));

// Monotone cubic interpolation keeps the velocity continuous at the samples
// and flat on either side of a hold or at a change of direction.
function slope(keys, i) {
  if (i === 0 || i === keys.length - 1) return 0;
  const [t,v] = keys[i], [t0,v0] = keys[i-1], [t1,v1] = keys[i+1];
  const a = (v-v0)/(t-t0), b = (v1-v)/(t1-t);
  return a*b <= 0 ? 0 : 2*a*b/(a+b);
}
function sample(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i=1; i<keys.length; i++) {
    const [end,to] = keys[i];
    if (t > end) continue;
    const [start,from] = keys[i-1], span = end-start, u = (t-start)/span;
    return from + (to-from)*u*u*(3-2*u)
      + span*u*(1-u)*((1-u)*slope(keys,i-1)-u*slope(keys,i));
  }
  return keys.at(-1)[1];
}

export function createShelfHandoff() {
  const pose = { main: 1, side: 1, turn: 0 };
  let transition;
  function rest(covered) {
    pose.main = pose.side = covered ? 0 : 1;
    pose.turn = covered ? 1 : 0;
    transition = null;
  }
  function update(now) {
    if (!transition) return false;
    const {start, duration, covered, interrupted, origin} = transition;
    const t = now-start;
    if (t >= duration) { rest(covered); return false; }
    if (interrupted) {
      const u = clamp01(t/duration), mix = u*u*(3-2*u);
      const size = covered ? 0 : 1, turn = covered ? 1 : 0;
      pose.main = origin.main + (size-origin.main)*mix;
      pose.side = origin.side + (size-origin.side)*mix;
      pose.turn = origin.turn + (turn-origin.turn)*mix;
    } else if (covered) {
      const withdraw = clamp01((t-300)/790) ** 3;
      pose.main = sample(pressed,t)*(1-withdraw);
      pose.side = 1-clamp01((t-320)/305) ** 2;
      pose.turn = withdraw;
    } else {
      pose.main = sample(mainReturn,t);
      pose.side = sample(sideReturn,t);
      pose.turn = 0;
    }
    return true;
  }
  return {
    pose, update,
    get active() { return Boolean(transition); },
    set(covered, immediate, now = performance.now()) {
      const interrupted = update(now);
      const size = covered ? 0 : 1;
      if (immediate || (!interrupted && pose.main === size)) { rest(covered); return; }
      const duration = interrupted ? 180 + 430*Math.min(1,Math.max(Math.abs(size-pose.main),Math.abs(size-pose.side))) : covered ? 1090 : 1460;
      transition = { start: now, covered, interrupted, duration, origin: { ...pose } };
      update(now);
    },
  };
}
