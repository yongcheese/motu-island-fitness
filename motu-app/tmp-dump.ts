import { buildHairLayout, HAIR_SPECS } from './src/constants/hair';
for (const id of ['hair-long-set', 'hair-mid-set']) {
  const l = buildHairLayout(HAIR_SPECS[id])!;
  const c = l.curtain!;
  console.log(id, 'curtain y=', c.y.toFixed(3), 'args rTop/rHem/height=', c.args[0].toFixed(3), c.args[1].toFixed(3), c.args[2].toFixed(3),
    'top=', (c.y + c.args[2] / 2).toFixed(3), 'hem=', (c.y - c.args[2] / 2).toFixed(3));
  const locks = l.locks.filter(k => k.key.startsWith('strand'));
  const tips = locks.map(k => k.position[1] - (k.args[1] / 2) * Math.cos(k.rotation[0]));
  const rings = locks.map(k => k.position[2]);
  console.log('  locks', locks.length, 'tip y min/max=', Math.min(...tips).toFixed(3), Math.max(...tips).toFixed(3),
    'ring min/max=', Math.min(...rings).toFixed(3), Math.max(...rings).toFixed(3), 'thickness=', locks[0].args[0]);
}
