import pathlib,re,json,subprocess,hashlib
import sys
# Run with a checkout of the revision recorded in florets/src/ai/upstream.json.
# Only paths, icon placeholders, and Rhea class tokens are changed in upstream TSX.
root = pathlib.Path(sys.argv[1]).resolve()
src = root / "apps/v4"
dst = pathlib.Path(__file__).resolve().parents[1]
names=json.loads((src/'content/docs/ai-elements/radix/meta.json').read_text())['pages']
styles=dict(re.findall(r'\.([\w-]+)\s*\{\s*@apply\s+([^;]+);\s*\}',(src/'registry/styles/style-rhea.css').read_text()))
queue=[(f'examples/radix/{n}-demo.tsx',f'florets/docs/src/ai/examples/{n}-demo.tsx') for n in names]
seen={}; deps=set()
def target(p):
 if re.match(r'(styles/[^/]+|registry/bases/[^/]+)/ui/',p): return 'florets/src/ai/ui/'+p.split('/')[-1]+'.tsx', 'registry/bases/radix/ui/'+p.split('/')[-1]+'.tsx'
 if re.match(r'registry/bases/[^/]+/hooks/',p): return 'florets/src/ai/hooks/'+p.split('/')[-1]+'.tsx','registry/bases/radix/hooks/'+p.split('/')[-1]+'.tsx'
 if re.match(r'registry/bases/[^/]+/lib/',p): return 'florets/src/ai/lib/'+p.split('/')[-1]+'.tsx', 'registry/bases/radix/lib/'+p.split('/')[-1]+'.tsx'
 if p=='components/markdown':return 'florets/src/ai/markdown.tsx',p+'.tsx'
 if p.startswith('lib/'):return 'florets/docs/src/ai/lib/'+p.split('/')[-1]+'.ts',p+'.ts'
 raise Exception(p)
while queue:
 origin,out=queue.pop(0)
 if out in seen:continue
 if not (src/origin).exists() and origin.endswith('.tsx'): origin=origin[:-1]
 text=(src/origin).read_text();seen[out]={'source':origin,'sha256':hashlib.sha256(text.encode()).hexdigest()}
 text=re.sub(r'import \{ IconPlaceholder \} from "[^"]+"\n','',text)
 icons=set()
 def icon(m):
  attrs=m[1];name=re.search(r'lucide="([^"]+)"',attrs)[1];icons.add(name)
  attrs=re.sub(r'\s*(lucide|tabler|hugeicons|phosphor|remixicon)="[^"]*"','',attrs)
  return '<'+name+attrs+' />'
 text=re.sub(r'<IconPlaceholder\s+([\s\S]*?)/>',icon,text)
 if icons:
  declaration='import { '+', '.join(sorted(icons))+' } from "lucide-react"\n'
  if text.startswith('"use client"'):
   text=text.replace('"use client"', '"use client"\n'+declaration, 1)
  else: text=declaration+text
 def imp(m):
  p=m[1]
  if p=='cn':
   dest='florets/src/lib/utils'
  elif p.startswith('@/'):
   dest,orig=target(p[2:]);queue.append((orig,dest));dest=re.sub(r'\.tsx?$','',dest)
  else:
   if not p.startswith('.'):deps.add(p)
   return m[0]
  import os
  rel=os.path.relpath(dst/dest,(dst/out).parent)
  if not rel.startswith('.'):rel='./'+rel
  return 'from "'+rel+'"'
 text=re.sub(r'from "([^"]+)"',imp,text)
 text=re.sub(r'\bcn-[\w-]+\b',lambda m:styles.get(m[0],m[0]),text)
 p=dst/out;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
manifest={'repository':'https://github.com/shadcn-ui/ui','revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=src).decode().strip(),'style':'radix-rhea','patterns':names,'files':seen}
(dst/'florets/src/ai/upstream.json').write_text(json.dumps(manifest,indent=2)+'\n')
(dst/'florets/src/ai/LICENSE').write_text((src.parents[1]/'LICENSE.md').read_text())
uis=sorted(p.stem for p in (dst/'florets/src/ai/ui').glob('*.tsx'))
(dst/'florets/src/ai/index.ts').write_text('// oxlint-disable oxc/no-barrel-file -- Public entry point for the upstream components.\n'+''.join(f'export * from "./ui/{n}";\n' for n in uis)+'export { Markdown } from "./markdown";\n')
css=(src/'app/globals.css').read_text();base=css[css.index('@theme inline'):css.index('@layer base')]
base=base.replace('--font-sans: var(--font-sans);','--font-sans: "Geist Variable", sans-serif;').replace('--font-mono: var(--font-mono);','--font-mono: "Geist Mono Variable", monospace;').replace('--font-heading: var(--font-heading);','--font-heading: "Geist Variable", sans-serif;')
(dst/'florets/src/ai/styles.css').write_text('@import "tailwindcss";\n@import "tw-animate-css";\n@import "./tailwind.css";\n@import "@fontsource-variable/geist";\n@import "@fontsource-variable/geist-mono";\n@source "./";\n@source "../../../node_modules/streamdown/dist/*.js";\n@custom-variant dark (&:is(.dark *));\n'+base+'\n@layer base { * { @apply border-border outline-ring/50; } body { @apply bg-background text-foreground font-sans antialiased; } }\n')
print(len(seen),'files',uis,'\nDEPENDENCIES', sorted(deps))

(dst / "florets/src/ai/tailwind.css").write_text((root / "packages/shadcn/src/tailwind.css").read_text())
for local, original in [("florets/src/ai/tailwind.css", "packages/shadcn/src/tailwind.css"), ("florets/src/ai/styles.css", "apps/v4/app/globals.css")]:
 manifest["files"][local] = {"source": original, "sha256": hashlib.sha256((root / original).read_bytes()).hexdigest()}
manifest["styleSource"] = {"source": "apps/v4/registry/styles/style-rhea.css", "sha256": hashlib.sha256((src / "registry/styles/style-rhea.css").read_bytes()).hexdigest()}
subprocess.run(["npm", "exec", "oxfmt", "--", "florets/src/ai", "florets/docs/src/ai/examples", "florets/docs/src/ai/lib"], cwd=dst, check=True)
for local, details in manifest["files"].items():
 details["importedSha256"] = hashlib.sha256((dst / local).read_bytes()).hexdigest()
(dst / "florets/src/ai/upstream.json").write_text(json.dumps(manifest, indent=2) + "\n")
