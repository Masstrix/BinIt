"""Regenerates app/src/shellFx.tsx (the Legendary shells in motion) from the design canvas Cosmetics-Motion board."""
import re, json
import xml.etree.ElementTree as ET

import sys

# usage: python scripts/gen-shell-fx.py <Cosmetics-Motion.dc.html from the design canvas> [out = app/src/shellFx.tsx]
src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'app/src/shellFx.tsx'
s = open(src, encoding='utf-8').read()
svgs = re.findall(r'<svg.*?</svg>', s, flags=re.S)
IDX = {'gold': 1, 'holo': 3, 'nightsky': 5, 'inferno': 7, 'nebula': 9, 'glacier': 11, 'galaxy': 13}

# the shared defs (the shell clip and the aura / shine / frost gradients the shells point at)
shared = ET.fromstring(svgs[0])
shared_defs = {el.attrib['id']: el for el in shared.iter() if 'id' in el.attrib}

SHELL_D = 'M11.2 34C7.4 26.4 8 15.6 15.6 10.2'
UNDER_D = 'M11.2 34L13.4 35.6L40.8 40'
VISOR_D = 'M24.2 14.8H44.4C45.6 17 46.3'
HILITE_D = 'M13 28C12.4 19.6 17 12.6 25.'
VENT_D = 'M36.6 32.4L43.6 33.5'


def camel(name):
    if name.startswith('aria-') or name.startswith('data-') or '-' not in name:
        return name
    head, *rest = name.split('-')
    return head + ''.join(p[:1].upper() + p[1:] for p in rest)


ids_used = set()


def collect_ids(el):
    for e in el.iter():
        if 'id' in e.attrib:
            ids_used.add(e.attrib['id'])


def attr_js(k, v):
    k = camel(k)
    if k == 'class':
        k = 'className'
    if k == 'id':
        return 'id={`${u}-%s`}' % v
    if 'url(#' in v:
        v = re.sub(r'url\(#([^)]+)\)', lambda m: 'url(#${u}-%s)' % m.group(1), v)
        return '%s={`%s`}' % (k, v)
    if '"' in v or '{' in v or '}' in v:
        return '%s={%s}' % (k, json.dumps(v))
    return '%s="%s"' % (k, v)


def jsx(el, ind=''):
    tag = el.tag.split('}')[-1]
    attrs = ' '.join(attr_js(k, v) for k, v in el.attrib.items())
    attrs = (' ' + attrs) if attrs else ''
    kids = list(el)
    if not kids and not (el.text or '').strip():
        return '%s<%s%s />' % (ind, tag, attrs)
    inner = '\n'.join(jsx(k, ind + '  ') for k in kids)
    return '%s<%s%s>\n%s\n%s</%s>' % (ind, tag, attrs, inner, ind, tag)


def frag(els, ind='      '):
    if not els:
        return 'null'
    return '(\n%s<>\n%s\n%s</>\n%s)' % (ind, '\n'.join(jsx(e, ind + '  ') for e in els), ind, ind[:-2])


def starts(el, d):
    return el.tag.split('}')[-1] == 'path' and el.attrib.get('d', '').startswith(d)


blocks = []
report = {}
for sid, i in IDX.items():
    root = ET.fromstring(svgs[i])
    kids = list(root)
    collect_ids(root)
    defs = kids[0]
    rest = kids[1:]
    base_i = next(n for n, e in enumerate(rest) if starts(e, SHELL_D))
    back = rest[:base_i]
    base = rest[base_i]
    after = rest[base_i + 1:]
    clip = [e for e in after if e.tag.split('}')[-1] == 'g' and 'clip-path' in e.attrib]
    last_eye = max(n for n, e in enumerate(after) if e.tag.split('}')[-1] == 'ellipse')
    front = after[last_eye + 1:]
    fill = base.attrib['fill']
    # which shared defs this shell points at (aura, shine, frost, clip)
    blob = ET.tostring(root, encoding='unicode')
    uses = sorted(set(re.findall(r'url\(#([^)]+)\)', blob)))
    own = {e.attrib['id'] for e in defs.iter() if 'id' in e.attrib}
    pull = [shared_defs[u] for u in uses if u not in own and u in shared_defs and u != 'c-shell']
    all_defs = list(defs) + pull
    fill_js = ('`url(#${u}-%s)`' % fill[5:-1]) if fill.startswith('url(#') else json.dumps(fill)
    gstops = [(st.attrib['offset'], st.attrib['stop-color']) for g in defs.iter() if g.tag.endswith('Gradient') for st in g if st.tag.endswith('stop')]
    report[sid] = {'fill': fill, 'stops': gstops, 'uses': uses}
    blocks.append('''  %s: (u) => ({
    fill: %s,
    defs: %s,
    back: %s,
    clip: %s,
    front: %s,
  }),''' % (sid, fill_js, frag(all_defs), frag(back), frag(clip), frag(front)))

header = '''import type { ReactNode } from "react";

/**
 * The seven Legendary shells in motion: the layers each one adds to the helmet. Generated from the "Legendary shells in
 * motion" board of the design canvas (Cosmetics-Motion), so change the design and regenerate rather than editing by hand.
 * Every element is SMIL (`animate`), so it needs no script and Helmet freezes it with `pauseAnimations()` where a still
 * frame is wanted (small helmets, reduced motion).
 *
 * `u` is a per-helmet prefix that keeps the ids of several helmets on one page apart.
 */
export interface ShellFx {
  /** What the shell is filled with (a gradient these defs make, or a plain colour). */
  fill: string;
  /** Gradients and the like the layers use. */
  defs: ReactNode;
  /** Behind the shell (an aura). */
  back: ReactNode;
  /** On the shell, clipped to its outline; under the stripe, decal and number. */
  clip: ReactNode;
  /** In front of everything but kept off the face (particles, glints, an outline pulse). */
  front: ReactNode;
}

export const SHELL_FX: Record<string, (u: string) => ShellFx> = {
'''
open(out, 'w', encoding='utf-8', newline='\n').write(header + '\n'.join(blocks) + '\n};\n')
print(json.dumps(report, indent=1))
