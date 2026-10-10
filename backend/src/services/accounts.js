// Accounts people create themselves (web or app) start out 'pending'. An admin
// then makes a random Admin Passphrase for the account in the admin panel and
// passes it on; the person enters it once, when they first sign in, and the
// account becomes 'active'. A passphrase works once and only for an hour — after
// that the admin makes a new one (which also replaces any older one).
const crypto = require('crypto');

const PASSPHRASE_TTL_MS = 60 * 60 * 1000;
// Wrong passphrases allowed before the current one stops working.
const MAX_ATTEMPTS = 5;
// Account requests waiting at once — keeps a public server from filling up.
const MAX_PENDING = 50;

// Short, common, unambiguous words: easy to read out or type on a phone.
const WORDS = `
acorn amber apple arrow aspen atlas autumn badge bamboo banjo basil beacon
berry birch bison blossom bramble breeze brook bubble cabin cactus camel candle
canyon cargo cedar cello chalk cherry cider cinder citrus clover cobalt comet
copper coral cotton crane crater cricket crystal cypress daisy delta denim desert
dingo dolphin dragon drift eagle ember emerald falcon fern fiddle field firefly
fjord flame flint forest fossil fox galaxy garnet geyser ginger glacier globe
goose granite grape gravel harbor hazel heron hickory honey horizon husky island
ivory jasmine jungle kayak kettle kiwi koala lagoon lantern laurel lemon lilac
lily linen lizard lotus lunar magnet mango maple marble meadow melon meteor
mint mirror mocha monsoon moose mosaic moss nectar nebula nickel nutmeg oak
oasis ocean olive onyx opal orbit orchid otter owl panda paper parrot peach
pebble pepper pigeon pine planet plum polar pony poppy prairie puffin quartz
quill rabbit raven reef ripple river robin rocket rose ruby saffron sage
salmon sapphire satin scarlet seal shadow shell sierra silver sky sparrow spruce
squid starling stone storm summit sunset swan tango thistle thunder tiger timber
topaz tulip tundra turtle velvet violet walnut walrus willow winter wolf yarrow
zebra zephyr
`.trim().split(/\s+/);

function generatePassphrase(words = 4) {
  return Array.from({ length: words }, () => WORDS[crypto.randomInt(WORDS.length)]).join('-');
}

// "Maple River  quiet_falcon" → "maple-river-quiet-falcon": forgiving about case,
// spaces and separators people use when typing it in.
function normalizePassphrase(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('-');
}

const hashPassphrase = (text) => crypto.createHash('sha256').update(normalizePassphrase(text)).digest('hex');

function passphraseMatches(text, hash) {
  if (!hash) return false;
  const a = Buffer.from(hashPassphrase(text), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Display names are also what people sign in with: 3–32 letters, numbers,
// spaces and . _ ' - (single spaces, nothing at either end).
function cleanDisplayName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 32) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(clean)) return null;
  return clean;
}

module.exports = {
  PASSPHRASE_TTL_MS,
  MAX_ATTEMPTS,
  MAX_PENDING,
  generatePassphrase,
  normalizePassphrase,
  hashPassphrase,
  passphraseMatches,
  cleanDisplayName,
};
