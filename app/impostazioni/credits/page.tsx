import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { Heart, Scale, Package, Image as ImageIcon, Database, ShieldAlert, ExternalLink } from 'lucide-react';

export const metadata = { title: 'Créditos e informações legais' };

const DEPS: { name: string; license: string; url: string }[] = [
  { name: 'Next.js', license: 'MIT', url: 'https://github.com/vercel/next.js' },
  { name: 'React', license: 'MIT', url: 'https://react.dev' },
  { name: 'three.js', license: 'MIT', url: 'https://threejs.org' },
  { name: 'Recharts', license: 'MIT', url: 'https://recharts.org' },
  { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com' },
  { name: 'Drizzle ORM', license: 'Apache-2.0', url: 'https://orm.drizzle.team' },
  { name: 'PGlite', license: 'Apache-2.0', url: 'https://pglite.dev' },
  { name: 'Neon serverless driver', license: 'MIT', url: 'https://github.com/neondatabase/serverless' },
  { name: '@anthropic-ai/sdk', license: 'MIT', url: 'https://github.com/anthropics/anthropic-sdk-typescript' },
  { name: 'lucide-react (icons)', license: 'ISC', url: 'https://lucide.dev' },
  { name: 'ExcelJS', license: 'MIT', url: 'https://github.com/exceljs/exceljs' },
  { name: 'PptxGenJS', license: 'MIT', url: 'https://gitbrent.github.io/PptxGenJS/' },
  { name: 'docx', license: 'MIT', url: 'https://github.com/dolanmiu/docx' },
  { name: 'PDFKit', license: 'MIT', url: 'https://pdfkit.org' },
  { name: 'jsPDF', license: 'MIT', url: 'https://github.com/parallax/jsPDF' },
  { name: 'marked', license: 'MIT', url: 'https://marked.js.org' },
  { name: 'fast-xml-parser', license: 'MIT', url: 'https://github.com/NaturalIntelligence/fast-xml-parser' },
  { name: 'date-fns', license: 'MIT', url: 'https://date-fns.org' },
];

const SOURCES = 'GDELT · Google News · Bluesky · Mastodon · Hacker News (Algolia) · Telegram · RSS/Atom · Reddit · YouTube · X · Meta (Instagram/Facebook) · TikTok · LinkedIn · NewsAPI';

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-sky-400 hover:text-sky-300">
      {children}<ExternalLink className="size-3" />
    </a>
  );
}

export default async function CreditsPage() {
  const t = await getT();
  return (
    <>
      <PageHeader title={t('page.credits.title', 'Créditos e informações legais')} subtitle="Créditos do projeto original, licenças, bibliotecas e condições de uso." />

      <div className="flex max-w-2xl flex-col gap-4">
        {/* Chi */}
        <section className="panel px-5 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Heart className="size-4 text-pink-400" /> Autoria original</h2>
          <div className="flex flex-col gap-2 text-sm text-slate-300">
            <p><span className="text-slate-500"> Criador e responsável pelo produto original:</span> <span className="font-medium text-slate-100">Massimo Scognamiglio</span> — concepção, design e direção do projeto Radar original.</p>
            <p><span className="text-slate-500"> Desenvolvimento com apoio de:</span> <span className="font-medium text-slate-100">Claude</span> da <Ext href="https://www.anthropic.com">Anthropic</Ext> — ferramenta de IA utilizada no desenvolvimento original e em recursos de análise de conteúdo do Radar.</p>
            <p className="text-xs text-slate-500">O projeto original foi desenvolvido por uma equipe pequena com colaboração de inteligência artificial. 🐣</p>
          </div>
        </section>

        {/* Licenza */}
        <section className="panel px-5 py-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><Scale className="size-4 text-sky-400" /> Licença</h2>
          <p className="text-sm text-slate-300">
            O projeto original Radar é <span className="font-medium text-slate-100">software livre e de código aberto</span>, distribuído sob a licença{' '}
            <Ext href="https://www.gnu.org/licenses/agpl-3.0.html">GNU AGPL-3.0</Ext>.
            © {new Date().getFullYear()} Massimo Scognamiglio and contributors.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Caso opere uma versão modificada como serviço em rede, verifique as obrigações de disponibilização do código-fonte previstas na AGPL.
            Código-fonte original: <Ext href="https://github.com/Scognamiglio1969/radar-intelligence">github.com/Scognamiglio1969/radar-intelligence</Ext>.
          </p>
        </section>

        {/* Open source */}
        <section className="panel px-5 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><Package className="size-4 text-violet-400" /> Tecnologias de código aberto</h2>
          <p className="mb-3 text-xs text-slate-500">O projeto utiliza as bibliotecas abaixo. Os termos integrais das licenças devem ser consultados nos respectivos pacotes em <code className="text-slate-400">node_modules/</code>.</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
            {DEPS.map((d) => (
              <div key={d.name} className="flex flex-col text-xs">
                <Ext href={d.url}>{d.name}</Ext>
                <span className="text-slate-600">{d.license}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Media / asset */}
        <section className="panel px-5 py-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300"><ImageIcon className="size-4 text-emerald-400" /> Mídia e recursos visuais</h2>
          <ul className="flex flex-col gap-2 text-xs text-slate-400">
            <li>
              Texturas de planetas, Sol e Lua presentes no <span className="text-slate-300">Conversation Galaxy</span> — © <Ext href="https://www.solarsystemscope.com/textures/">Solar System Scope</Ext>, sob a licença <span className="text-slate-300">CC BY 4.0</span>.
            </li>
            <li>
              Fotografia de ovo (conteúdo adicional) — “White chicken egg”, via <Ext href="https://commons.wikimedia.org/wiki/File:White_chicken_egg_square.jpg">Wikimedia Commons</Ext>, <span className="text-slate-300">CC BY 2.0</span>.
            </li>
            <li>
              Fotografia de pintinho (conteúdo adicional) — “Day old chick”, via <Ext href="https://commons.wikimedia.org/wiki/File:Day_old_chick_white_background.jpg">Wikimedia Commons</Ext>, <span className="text-slate-300">GFDL 1.2</span>.
            </li>
          </ul>
        </section>

        {/* Fonti dati */}
        <section className="panel px-5 py-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><Database className="size-4 text-amber-400" /> Fontes de dados</h2>
          <p className="text-xs leading-relaxed text-slate-400">
            O Radar original consulta dados públicos das seguintes fontes: <span className="text-slate-300">{SOURCES}</span>.
            Marcas, nomes e conteúdos pertencem aos respectivos titulares; a ferramenta não representa vínculo ou endosso dessas organizações.
          </p>
        </section>

        {/* Legale */}
        <section className="panel px-5 py-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300"><ShieldAlert className="size-4 text-red-400" /> Condições legais e uso responsável</h2>
          <p className="text-xs leading-relaxed text-slate-400">
            A ferramenta original é disponibilizada <span className="text-slate-300">no estado em que se encontra, sem garantia de qualquer natureza</span>. O operador deve respeitar
            os termos de cada fonte e a legislação aplicável de proteção de dados, incluindo a LGPD no Brasil. Algumas fontes restringem
            o acesso automatizado. Resultados produzidos por IA podem conter erros ou vieses e exigem revisão humana.
            Para comunicar falhas de segurança do projeto original, consulte <Ext href="https://github.com/Scognamiglio1969/radar-intelligence/blob/main/SECURITY.md">SECURITY.md</Ext>.
          </p>
        </section>

        <p className="pb-6 text-center text-[11px] text-slate-600">Desenvolvido originalmente com colaboração entre pessoas e inteligência artificial. 🛰️</p>
      </div>
    </>
  );
}
