// What is left of a track name once working-title endings are gone, to spot the same song twice:
// "Kreisel (neu)", "Kreisel – Demo 2", "kreisel_v3" all become "kreisel". "Kreisel Instrumental" stays apart.
const ENDING = /[\s_\-–—.]+(demo|skizze|sketch|neu|new|alt|old|rough|idee|idea|wip|mix|mixdown|master|bounce|final|take\s*\d+|v\d+|version\s*\d+|\d+)$/i;

export function songKey(name: string) {
  let key = name.toLowerCase().replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  for (let before = ''; before !== key; ) {
    before = key;
    key = key.replace(ENDING, '').replace(/[\s_\-–—.]+$/u, '').trim();
  }
  return key;
}
