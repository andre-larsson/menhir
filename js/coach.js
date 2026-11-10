/*
 * Menhir - rules taught in play.
 *
 * Pure data and a tiny step machine, shared by the page (js/main.js) and the
 * Node checks. No DOM, no storage, no clocks.
 *
 * A lesson belongs to the island (by name) that introduces its rule. It shows
 * in the message row under the island name, one step at a time, and marks
 * what it talks about on the board. A step ends on a game event:
 *   move   the keeper moved           push   a stone was pushed
 *   slide  a stone slid on frost      bog    a stone sank into bog
 *   win    the island was solved
 * Text may be a string or { key, touch } for the device in use.
 * `hl` names what to highlight: socket, stones, marked, far (the stone
 * farthest from the keeper), keeper, frost, bog, water, filled (bog filled in).
 *
 * Tips are one-off notes for moments that can happen on any island (a lost
 * stone, a blocked push, being stuck). Each is shown once, then remembered.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MenhirCoach = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LESSONS = {
    'First Light': {
      id: 'basics', chip: 'How to play',
      steps: [
        {
          text: 'Stand the stone on the socket.',
          sub: { key: 'Walk with the arrow keys or WASD, or click a tile.', touch: 'Swipe the board or use the pad to walk, or tap a tile.' },
          hl: ['socket', 'stones'], until: 'move', pad: true,
        },
        {
          text: { key: 'Walk into the stone to push it.', touch: 'Walk into the stone, or tap it from beside it, to push it.' },
          sub: 'The dashed outline shows where it will land.',
          hl: ['stones'], until: 'push',
        },
        {
          text: 'It toppled. Push it along its length to stand it up.',
          sub: 'Raise it onto the socket.',
          hl: ['socket'], until: 'win',
        },
      ],
    },
    'Domino Line': {
      id: 'domino', chip: 'New: dominoes',
      steps: [
        { text: 'A falling stone knocks over any stone in its way.', sub: 'Stand a stone on every socket.', hl: ['stones', 'socket'], until: 'win' },
      ],
    },
    'Hoarfrost': {
      id: 'frost', chip: 'New: frost',
      steps: [
        { text: 'Frost is slick: a stone keeps tipping until it is off the ice.', sub: 'You walk on it normally. A dotted trail previews the slide.', hl: ['frost'], until: 'win' },
      ],
    },
    'Black Ice': {
      id: 'knock', chip: 'New: frost and dominoes',
      steps: [
        { text: 'A sliding stone that hits another stone knocks it on, and stops.', sub: 'You can’t reach the far stone, but the ice can.', hl: ['far', 'frost'], until: 'win' },
      ],
    },
    'Peat Bog': {
      id: 'bog', chip: 'New: bog and water', covers: ['water'],
      steps: [
        { text: 'Bog swallows a stone, and becomes firm ground where it sank.', sub: 'Open water swallows a stone for good.', hl: ['bog', 'water'], until: 'bog' },
        { text: 'Where the stone sank, the bog is firm ground now.', sub: 'You and the stones can cross it.', hl: ['filled'], until: 'win' },
      ],
    },
    'Sunside Up': {
      id: 'mark', chip: 'New: marked stones',
      steps: [
        { text: 'A marked stone counts only with its sun facing the sky.', sub: 'The gold band is at the sun end. A gold dot in the preview shows where the sun will face.', hl: ['marked', 'socket'], until: 'win' },
      ],
    },
  };

  const TIPS = {
    rewind: 'That push left the island unwinnable. Rewind goes back to the last position that can still be won.',
    hint: { key: 'Stuck? Hint (H) shows the next push. A hinted solve earns no golden sun.', touch: 'Stuck? Hint shows the next push. A hinted solve earns no golden sun.' },
    water: 'Open water swallows a stone for good. A blue outline warns you before you push.',
    blocked: 'Blocked. If anything in a chain can’t move (a wall, a rock, a jammed stone), nothing moves.',
  };

  function lessonFor(name) { return LESSONS[name] || null; }

  // Pick the wording for the device in use.
  function say(t, touch) {
    if (t == null) return '';
    return typeof t === 'string' ? t : touch ? t.touch : t.key;
  }

  // Advance a step index by the events of one move. Returns the new index;
  // index === steps.length means the lesson is finished.
  function advance(lesson, index, ev) {
    let i = index;
    while (i < lesson.steps.length && ev[lesson.steps[i].until]) i++;
    return i;
  }

  return { LESSONS, TIPS, lessonFor, say, advance };
});
