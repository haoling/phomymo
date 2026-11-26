#!/usr/bin/env python3
"""素材集(#27)の SVG とマニフェストを作り直す。

使い方:
  npm pack @tabler/icons @twemoji/svg   # 適当な作業ディレクトリで
  (それぞれ展開して)
  python3 scripts/build-assets.py <tabler-icons/package> <twemoji-svg/package>

英語の表示名だけ直したとき(SVG はそのまま):
  python3 scripts/build-assets.py --names-only

一覧は scripts/asset-list.py、英語の表示名は scripts/asset-names-en.py を編集する。自作ステッカーは src/web/assets/stickers/ に直接置く。
"""
import json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'web', 'assets')
ns = {}
exec(open(os.path.join(ROOT, 'scripts', 'asset-list.py'), encoding='utf-8').read(), ns)
en = {}
exec(open(os.path.join(ROOT, 'scripts', 'asset-names-en.py'), encoding='utf-8').read(), en)


def add_english_names(manifest):
    """表示言語が English のときに使う名前(nameEn)を付ける"""
    for c in manifest['categories']:
        c['nameEn'] = en['CATEGORIES_EN'].get(c['id'], c['name'])
    for item in manifest['items']:
        source, _, rest = item['id'].partition(':')
        if source == 'tabler':
            base, _, variant = rest.partition(':')
            name = en['tabler_name_en'](base)
            item['nameEn'] = f'{name} (filled)' if variant == 'filled' else name
        elif source == 'twemoji':
            item['nameEn'] = en['TWEMOJI_EN'].get(rest, item['name'])
        elif source == 'sticker':
            item['nameEn'] = en['STICKERS_EN'].get(rest, item['name'])
    return manifest


def write_manifest(manifest):
    with open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write('\n')


def clean_tabler(svg):
    svg = re.sub(r'\s*class="[^"]*"', '', svg)
    svg = re.sub(r'<path stroke="none" d="M0 0h24v24H0z" fill="none"\s*/>', '', svg)
    svg = re.sub(r'\s+', ' ', svg).replace('> <', '><').strip()
    return svg + '\n'


def main(tabler_dir, twemoji_dir):
    items = {}
    order = []
    for d in ('tabler', 'twemoji'):
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)
        os.makedirs(os.path.join(OUT, d))
    for cat, entries in ns['TABLER'].items():
        for name, ja, tags in entries:
            variant = 'filled' if name.startswith('filled:') else 'outline'
            base = name.split(':')[-1]
            fname = f'{base}-filled.svg' if variant == 'filled' else f'{base}.svg'
            item_id = f'tabler:{base}' + (':filled' if variant == 'filled' else '')
            if item_id in items:
                if cat not in items[item_id]['cats']:
                    items[item_id]['cats'].append(cat)
                continue
            src = os.path.join(tabler_dir, 'icons', variant, base + '.svg')
            with open(src, encoding='utf-8') as f:
                svg = clean_tabler(f.read())
            with open(os.path.join(OUT, 'tabler', fname), 'w', encoding='utf-8') as f:
                f.write(svg)
            items[item_id] = {
                'id': item_id, 'cats': [cat], 'file': f'tabler/{fname}', 'name': ja,
                'tags': tags.split() + [base.replace('-', ' ')],
                'kind': 'line' if variant == 'outline' else 'fill', 'source': 'tabler',
            }
            order.append(item_id)
    for cp, ja, tags in ns['TWEMOJI']:
        item_id = f'twemoji:{cp}'
        shutil.copy(os.path.join(twemoji_dir, cp + '.svg'), os.path.join(OUT, 'twemoji', cp + '.svg'))
        items[item_id] = {
            'id': item_id, 'cats': ['emoji'], 'file': f'twemoji/{cp}.svg', 'name': ja,
            'tags': tags.split(), 'kind': 'color', 'source': 'twemoji',
        }
        order.append(item_id)
    for sid, ja, tags in ns['STICKERS']:
        path = os.path.join(OUT, 'stickers', sid + '.svg')
        if not os.path.exists(path):
            sys.exit(f'missing sticker: {path}')
        item_id = f'sticker:{sid}'
        items[item_id] = {
            'id': item_id, 'cats': ['stickers'], 'file': f'stickers/{sid}.svg', 'name': ja,
            'tags': tags.split(), 'kind': 'fill', 'source': 'original',
        }
        order.append(item_id)
    manifest = {
        'version': 1,
        'categories': [{'id': c, 'name': n} for c, n in ns['CATEGORIES']],
        'sources': {
            'tabler': {'name': 'Tabler Icons', 'license': 'MIT', 'url': 'https://tabler.io/icons'},
            'twemoji': {'name': 'Twemoji', 'license': 'CC-BY 4.0', 'url': 'https://github.com/jdecked/twemoji'},
            'original': {'name': '自作のステッカー', 'license': 'MIT', 'url': ''},
        },
        'items': [items[i] for i in order],
    }
    write_manifest(add_english_names(manifest))
    print(f'{len(order)} items')


if __name__ == '__main__':
    if sys.argv[1:] == ['--names-only']:
        with open(os.path.join(OUT, 'manifest.json'), encoding='utf-8') as f:
            write_manifest(add_english_names(json.load(f)))
        print('updated English names')
    else:
        main(sys.argv[1], sys.argv[2])
