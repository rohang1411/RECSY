import { parseHTML } from 'linkedom';

async function main() {
  const r = await fetch('https://www.gsmarena.com/apple_iphone_15_pro_max-12548.php', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    },
  });
  const html = await r.text();
  const { document } = parseHTML(html);
  const specs = Array.from(document.querySelectorAll('[data-spec]')).map((e) => ({
    spec: e.getAttribute('data-spec'),
    text: e.textContent,
  }));
  console.log(JSON.stringify(specs, null, 2));
}

main().catch(console.error);
