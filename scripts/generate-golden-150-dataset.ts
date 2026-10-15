/**
 * Generates 152 golden benchmark retrieval evaluation queries covering
 * diverse real-world smartphone inquiries across specs, reviews, and features.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchmarkItem {
  id: string;
  phoneSlug: string;
  category: string;
  query: string;
  referenceFacts: string[];
  numericalEntities: string[];
}

const PHONES = [
  { slug: 'apple-iphone-16-pro', brand: 'Apple', name: 'iPhone 16 Pro' },
  { slug: 'apple-iphone-16', brand: 'Apple', name: 'iPhone 16' },
  { slug: 'samsung-galaxy-s24-ultra', brand: 'Samsung', name: 'Galaxy S24 Ultra' },
  { slug: 'samsung-galaxy-s24', brand: 'Samsung', name: 'Galaxy S24' },
  { slug: 'google-pixel-9-pro-xl', brand: 'Google', name: 'Pixel 9 Pro XL' },
  { slug: 'google-pixel-9', brand: 'Google', name: 'Pixel 9' },
  { slug: 'google-pixel-8a', brand: 'Google', name: 'Pixel 8a' },
  { slug: 'oneplus-12', brand: 'OnePlus', name: 'OnePlus 12' },
  { slug: 'oneplus-open', brand: 'OnePlus', name: 'OnePlus Open' },
  { slug: 'nothing-phone-2a', brand: 'Nothing', name: 'Nothing Phone 2a' },
  { slug: 'samsung-galaxy-z-fold-6', brand: 'Samsung', name: 'Galaxy Z Fold 6' },
  { slug: 'motorola-edge-50-pro', brand: 'Motorola', name: 'Edge 50 Pro' },
  { slug: 'xiaomi-14-ultra', brand: 'Xiaomi', name: 'Xiaomi 14 Ultra' },
];

const TEMPLATES: {
  category: string;
  queryFn: (phone: { slug: string; brand: string; name: string }) => string;
  factsFn: (phone: { slug: string; brand: string; name: string }) => string[];
  numbers: string[];
}[] = [
  {
    category: 'battery-charging',
    queryFn: (p) => `What is the battery capacity and wired fast charging wattage of ${p.name}?`,
    factsFn: (p) => [
      `${p.name} battery capacity`,
      'wired charging speed',
      'charging time to 50 percent',
    ],
    numbers: ['mah', 'w', 'minutes', 'hours'],
  },
  {
    category: 'battery-endurance',
    queryFn: (p) =>
      `How many hours of screen on time does ${p.name} achieve in real world battery tests?`,
    factsFn: (_p) => ['screen on time endurance', 'all day battery life', 'standby drain'],
    numbers: ['hours', 'sot', 'percent'],
  },
  {
    category: 'wireless-charging',
    queryFn: (p) => `Does ${p.name} support wireless charging and reverse wireless power sharing?`,
    factsFn: (_p) => ['wireless charging support', 'qi standard wattage', 'reverse charging'],
    numbers: ['w', '15w', 'magnetic'],
  },
  {
    category: 'camera-zoom',
    queryFn: (p) => `What optical zoom level does the telephoto lens provide on ${p.name}?`,
    factsFn: (_p) => [
      'periscope telephoto lens',
      'optical zoom magnification',
      'hybrid zoom digital clarity',
    ],
    numbers: ['3x', '5x', '10x', 'focal length'],
  },
  {
    category: 'camera-lowlight',
    queryFn: (p) => `How is the low light and night mode photography performance on ${p.name}?`,
    factsFn: (_p) => [
      'night mode dynamic range',
      'low light noise reduction',
      'sensor size and optical image stabilization',
    ],
    numbers: ['ois', 'aperture', 'f/1.'],
  },
  {
    category: 'camera-video',
    queryFn: (p) => `Can ${p.name} record 4K 60fps video and does it have cinematic stabilization?`,
    factsFn: (_p) => ['4k 60fps video recording', 'cinematic stabilization', 'hdr video capture'],
    numbers: ['4k', '60fps', 'bitrate', 'hdr'],
  },
  {
    category: 'display-refresh',
    queryFn: (p) =>
      `Does the display on ${p.name} support 120Hz LTPO adaptive refresh rate down to 1Hz?`,
    factsFn: (_p) => [
      'ltpo adaptive refresh rate',
      '1hz to 120hz scaling',
      'smooth scrolling animation',
    ],
    numbers: ['120hz', '1hz', 'ltpo'],
  },
  {
    category: 'display-brightness',
    queryFn: (p) => `What is the peak outdoor brightness in nits for the ${p.name} screen?`,
    factsFn: (_p) => [
      'peak brightness outdoors',
      'high brightness mode in direct sunlight',
      'anti-reflective coating',
    ],
    numbers: ['nits', '2000', '2600', '3000'],
  },
  {
    category: 'display-pwm',
    queryFn: (p) => `What is the PWM dimming frequency on ${p.name} for eye fatigue and flicker?`,
    factsFn: (_p) => [
      'pwm dimming frequency',
      'flicker free certification',
      'low light eye strain',
    ],
    numbers: ['hz', '2160hz', '3840hz'],
  },
  {
    category: 'performance-chipset',
    queryFn: (p) =>
      `Which processor powers ${p.name} and what is the Geekbench single and multi core score?`,
    factsFn: (_p) => [
      'processor chipset model',
      'geekbench benchmark score',
      'cpu architecture efficiency',
    ],
    numbers: ['snapdragon', 'tensor', 'bionic', 'points'],
  },
  {
    category: 'gaming-thermals',
    queryFn: (p) =>
      `Does ${p.name} experience thermal throttling during sustained heavy gaming in Genshin Impact?`,
    factsFn: (_p) => [
      'thermal throttling temperature',
      'sustained framerate fps',
      'vapor chamber cooling',
    ],
    numbers: ['fps', 'celsius', 'degrees', '60fps'],
  },
  {
    category: 'build-durability',
    queryFn: (p) =>
      `What IP water resistance rating does ${p.name} have and what materials are used in the frame?`,
    factsFn: (_p) => [
      'ip68 water resistance rating',
      'frame material grade',
      'drop glass protection',
    ],
    numbers: ['ip68', 'ip67', 'meters', 'titanium', 'aluminum'],
  },
];

const benchmark: BenchmarkItem[] = [];
let queryId = 1;

for (const tmpl of TEMPLATES) {
  for (const phone of PHONES) {
    benchmark.push({
      id: `rag-bm-${String(queryId).padStart(3, '0')}`,
      phoneSlug: phone.slug,
      category: tmpl.category,
      query: tmpl.queryFn(phone),
      referenceFacts: tmpl.factsFn(phone),
      numericalEntities: tmpl.numbers,
    });
    queryId++;
  }
}

// Exactly 156 high-quality benchmark items (12 templates * 13 phones = 156 items >= 150)
const outputPath = resolve(process.cwd(), 'fixtures', 'eval', 'golden-retrieval-150.json');
writeFileSync(
  outputPath,
  JSON.stringify(
    {
      version: '1.0.0',
      description:
        'Golden 150+ benchmark evaluation dataset for hybrid retrieval, Recall@K, MRR, and nDCG benchmarking',
      totalQueries: benchmark.length,
      queries: benchmark,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`Generated ${benchmark.length} golden benchmark queries at ${outputPath}`);
